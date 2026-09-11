/**
 * Plan entitlement enforcement at the API boundary, against Postgres (and the
 * dev ClickHouse for the reads that reach it). Run with RUN_DB_TESTS=1.
 *
 * A small Fastify app is built from the real route files, the real
 * site-access and entitlement plugins and the real error handler; only
 * session auth is replaced by an `x-user` header so no cookie or sessions
 * table is needed. One account per billing state, each with one site; rows
 * carry a unique marker and are deleted afterwards. Nothing job-wide runs.
 */
import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { Redis } from "ioredis";

import prisma from "../../../lib/prisma.js";
import { clickhouse } from "../../../lib/clickhouse.js";
import { closeRedis } from "../../../lib/redis.js";
import type { AppContext } from "../../../lib/context.js";
import { registerErrorHandler } from "../../../plugins/error-handler.js";
import siteAccessPlugin from "../../../plugins/site-access.plugin.js";
import entitlementPlugin from "../../../plugins/entitlement.plugin.js";
import analyticsRoutes from "../../../routes/v1/analytics.js";
import conversionsRoutes from "../../../routes/v1/conversions.js";
import gscRoutes from "../../../routes/v1/gsc.js";
import { unauthorized } from "../../../errors/http-errors.js";
import { PLAN_CATALOG, planRowFromCatalog } from "../catalog/index.js";
import { retentionFloor } from "../../../http/normalize/period.js";
import { resolveRetainedWindow } from "./retention.js";

const RUN = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const skip = RUN ? false : "set RUN_DB_TESTS=1 with DATABASE_URL to run";

const marker = `ent-${randomUUID().slice(0, 8)}`;
const DAY = 86_400_000;
const now = new Date();

/** In-memory Redis: enough for the site and entitlement caches. */
const memoryRedis = () => {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    setex: async (k: string, _ttl: number, v: string) => (store.set(k, v), "OK"),
    set: async (k: string, v: string) => (store.set(k, v), "OK"),
    del: async (...keys: string[]) => keys.reduce((n, k) => n + (store.delete(k) ? 1 : 0), 0),
  } as unknown as Redis;
};

type Account = { userId: string; siteId: string };
const accounts: Record<string, Account> = {};
const userIds: string[] = [];
let app: FastifyInstance;
let ctx: AppContext;

const seedPlans = async () => {
  const ids: Record<string, string> = {};
  for (const code of ["free", "starter", "growth", "business"] as const) {
    const def = PLAN_CATALOG.find((p) => p.code === code)!;
    ids[code] = (await prisma.plan.upsert({ where: { code }, update: {}, create: planRowFromCatalog(def, 0) })).id;
  }
  return ids;
};

/**
 * One account in a given billing state. `history` is the list of subscription
 * rows, oldest first; the last live one is what entitlements resolve to.
 */
const seedAccount = async (
  label: string,
  rows: { planId: string; status: "ACTIVE" | "TRIALING" | "CANCELED" | "PAST_DUE"; paid?: boolean; restriction?: "NONE" | "PAYMENT_FAILED"; trialEndsAt?: Date }[],
  opts: { isPublic?: boolean } = {},
): Promise<Account> => {
  const user = await prisma.user.create({ data: { name: `${marker} ${label}`, email: `${marker}-${label}@example.test`, provider: "email" } });
  userIds.push(user.id);
  const site = await prisma.website.create({
    data: { name: label, domain: `${marker}-${label}.example.test`, userId: user.id, isPublic: opts.isPublic ?? false, publicSlug: opts.isPublic ? `${marker}-${label}` : null },
  });
  for (const [i, row] of rows.entries()) {
    await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: row.planId,
        status: row.status,
        billingCycle: "MONTHLY",
        providerSubscriptionId: row.paid ? `sub_${marker}_${label}_${i}` : null,
        restriction: row.restriction ?? "NONE",
        trialEndsAt: row.trialEndsAt ?? null,
        currentPeriodStart: new Date(now.getTime() - 10 * DAY),
        currentPeriodEnd: new Date(now.getTime() + 20 * DAY),
        canceledAt: row.status === "CANCELED" ? new Date(now.getTime() - DAY) : null,
        createdAt: new Date(now.getTime() - (rows.length - i) * DAY),
      },
    });
  }
  return { userId: user.id, siteId: site.id };
};

before(async () => {
  if (!RUN) return;
  const plan = await seedPlans();
  ctx = { prisma, redis: memoryRedis(), clickhouse };

  accounts.free = await seedAccount("free", [{ planId: plan.free, status: "ACTIVE" }]);
  accounts.freePublic = await seedAccount("free-public", [{ planId: plan.free, status: "ACTIVE" }], { isPublic: true });
  accounts.starter = await seedAccount("starter", [{ planId: plan.starter, status: "ACTIVE", paid: true }]);
  accounts.growth = await seedAccount("growth", [{ planId: plan.growth, status: "ACTIVE", paid: true }]);
  accounts.growthPublic = await seedAccount("growth-public", [{ planId: plan.growth, status: "ACTIVE", paid: true }], { isPublic: true });
  accounts.business = await seedAccount("business", [{ planId: plan.business, status: "ACTIVE", paid: true }]);
  accounts.trial = await seedAccount("trial", [{ planId: plan.growth, status: "TRIALING", trialEndsAt: new Date(now.getTime() + 10 * DAY) }]);
  // Trial that ran out and was moved to Free by the trials job.
  accounts.expiredTrial = await seedAccount("expired-trial", [
    { planId: plan.growth, status: "CANCELED", trialEndsAt: new Date(now.getTime() - 2 * DAY) },
    { planId: plan.free, status: "ACTIVE" },
  ]);
  // Paid subscription the provider ended; back on Free.
  accounts.ended = await seedAccount("ended", [
    { planId: plan.business, status: "CANCELED", paid: true },
    { planId: plan.free, status: "ACTIVE" },
  ]);
  // Paid, ingest restricted for non-payment: features stay, ingest does not.
  accounts.restricted = await seedAccount("restricted", [{ planId: plan.growth, status: "PAST_DUE", paid: true, restriction: "PAYMENT_FAILED" }]);
  await prisma.website.update({ where: { id: accounts.restricted.siteId }, data: { isBlocked: true } });

  app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.decorateRequest("session", null as never);
  app.decorate("redis", ctx.redis);
  app.addHook("onRequest", async (request) => {
    request.ctx = ctx;
  });
  // Session auth stand-ins: the user is whoever the x-user header names.
  const sessionFor = (request: FastifyRequest) => {
    const userId = request.headers["x-user"];
    return typeof userId === "string" && userId ? { userId, email: "", name: "", sessionId: "test" } : null;
  };
  app.decorate("authenticate", async (request: FastifyRequest) => {
    const session = sessionFor(request);
    if (!session) throw unauthorized("Authentication required");
    request.session = session;
  });
  app.decorate("optionalAuthenticate", async (request: FastifyRequest) => {
    const session = sessionFor(request);
    if (session) request.session = session;
  });
  registerErrorHandler(app);
  await app.register(siteAccessPlugin);
  await app.register(entitlementPlugin);
  await app.register(analyticsRoutes, { prefix: "/api/v1" });
  await app.register(conversionsRoutes, { prefix: "/api/v1" });
  await app.register(gscRoutes, { prefix: "/api/v1" });
  await app.ready();
});

after(async () => {
  await closeRedis();
  if (!RUN) return;
  await app.close();
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
  await clickhouse.close().catch(() => {});
});

const call = async (method: "GET" | "POST", url: string, as: Account | null, body?: unknown) => {
  const res = await app.inject({
    method,
    url,
    headers: as ? { "x-user": as.userId } : {},
    ...(body ? { payload: body } : {}),
  });
  return { status: res.statusCode, body: res.json() as { success: boolean; data?: unknown; meta?: Record<string, unknown>; error?: { code: string; message: string; details?: Record<string, unknown> } } };
};

const expectDenied = (r: Awaited<ReturnType<typeof call>>, feature: string) => {
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(r.body.error?.code, "FEATURE_NOT_AVAILABLE");
  assert.equal(r.body.error?.details?.feature, feature);
  assert.match(r.body.error?.message ?? "", /not included in the .* plan/);
};

// ─── Funnels ─────────────────────────────────────────────────────────────────

test("funnels: Free is denied with a machine-readable code; Starter, Growth and Business are allowed", { skip }, async () => {
  expectDenied(await call("GET", `/api/v1/websites/${accounts.free.siteId}/funnels`, accounts.free), "funnels");
  assert.equal((await call("GET", `/api/v1/websites/${accounts.starter.siteId}/funnels`, accounts.starter)).status, 200);
  assert.equal((await call("GET", `/api/v1/websites/${accounts.growth.siteId}/funnels`, accounts.growth)).status, 200);
  assert.equal((await call("GET", `/api/v1/websites/${accounts.business.siteId}/funnels`, accounts.business)).status, 200);
});

test("funnels: the write paths are gated too, not only the list", { skip }, async () => {
  const body = { name: "Signup", steps: [{ pagePath: "/" }, { pagePath: "/signup" }] };
  expectDenied(await call("POST", `/api/v1/websites/${accounts.free.siteId}/funnels`, accounts.free, body), "funnels");
  assert.equal(await prisma.funnel.count({ where: { websiteId: accounts.free.siteId } }), 0, "nothing was created");
  const created = await call("POST", `/api/v1/websites/${accounts.starter.siteId}/funnels`, accounts.starter, body);
  assert.equal(created.status, 201, JSON.stringify(created.body));
});

test("funnels: unauthenticated is 401, and an entitled user still cannot reach another owner's site", { skip }, async () => {
  assert.equal((await call("GET", `/api/v1/websites/${accounts.growth.siteId}/funnels`, null)).status, 401);
  const other = await call("GET", `/api/v1/websites/${accounts.free.siteId}/funnels`, accounts.growth);
  assert.equal(other.status, 404, "ownership check after the plan check is unchanged");
});

// ─── Journeys ────────────────────────────────────────────────────────────────

const journeys = (a: Account, viewer: Account | null = a) => call("GET", `/api/v1/${a.siteId}/journeys?period=last_7_days`, viewer);

test("journeys: Free and Starter denied, Growth and Business allowed", { skip }, async () => {
  expectDenied(await journeys(accounts.free), "journeys");
  expectDenied(await journeys(accounts.starter), "journeys");
  assert.equal((await journeys(accounts.growth)).status, 200);
  assert.equal((await journeys(accounts.business)).status, 200);
});

test("journeys on a public dashboard follow the owner's plan, not the viewer's", { skip }, async () => {
  // Anonymous viewer on a Growth owner's public site: allowed.
  assert.equal((await journeys(accounts.growthPublic, null)).status, 200);
  // Anonymous viewer on a Free owner's public site: denied, even though the site is public.
  expectDenied(await journeys(accounts.freePublic, null), "journeys");
  // A Business viewer looking at a Free owner's public site is still denied: the owner's plan rules.
  expectDenied(await journeys(accounts.freePublic, accounts.business), "journeys");
});

// ─── Search Console ──────────────────────────────────────────────────────────

test("search console: Free denied on every site route; Starter allowed", { skip }, async () => {
  expectDenied(await call("GET", `/api/v1/websites/${accounts.free.siteId}/gsc`, accounts.free), "search_console");
  expectDenied(await call("GET", `/api/v1/websites/${accounts.free.siteId}/gsc/auth-url`, accounts.free), "search_console");
  expectDenied(await call("GET", `/api/v1/websites/${accounts.free.siteId}/gsc/search-analytics`, accounts.free), "search_console");
  const ok = await call("GET", `/api/v1/websites/${accounts.starter.siteId}/gsc`, accounts.starter);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

// ─── Billing states ──────────────────────────────────────────────────────────

test("an active trial has the trial plan's features", { skip }, async () => {
  assert.equal((await journeys(accounts.trial)).status, 200);
  assert.equal((await call("GET", `/api/v1/websites/${accounts.trial.siteId}/funnels`, accounts.trial)).status, 200);
});

test("an expired trial and an ended paid subscription are Free again: paid features denied", { skip }, async () => {
  expectDenied(await journeys(accounts.expiredTrial), "journeys");
  expectDenied(await call("GET", `/api/v1/websites/${accounts.expiredTrial.siteId}/funnels`, accounts.expiredTrial), "funnels");
  expectDenied(await journeys(accounts.ended), "journeys");
  expectDenied(await call("GET", `/api/v1/websites/${accounts.ended.siteId}/gsc`, accounts.ended), "search_console");
});

test("a paid account restricted for non-payment keeps its plan's features; only ingest is off", { skip }, async () => {
  assert.equal((await journeys(accounts.restricted)).status, 200);
  assert.equal((await call("GET", `/api/v1/websites/${accounts.restricted.siteId}/funnels`, accounts.restricted)).status, 200);
});

// ─── Retention ───────────────────────────────────────────────────────────────

const floorFor = (days: number) => retentionFloor({ retentionDays: days, timezone: "UTC", now: now.getTime() });

test("retention: each plan's window is cut at its own floor, whatever `from` the client sends", { skip }, async () => {
  const expected: [Account, number][] = [
    [accounts.free, 90],
    [accounts.starter, 365],
    [accounts.growth, 730],
    [accounts.business, 1095],
  ];
  for (const [account, days] of expected) {
    const w = await resolveRetainedWindow(ctx, {
      ownerId: account.userId,
      timezone: "UTC",
      query: { period: "custom", from: "2000-01-01", to: "2030-01-01" },
      now: now.getTime(),
    });
    assert.equal(w.retention.days, days);
    assert.equal(w.from, floorFor(days), `${days} day plan starts at its floor`);
    assert.equal(w.retention.clamped, true);
    assert.equal(w.retention.empty, false);
  }
});

test("retention: a request inside the window is untouched; one entirely before it is empty", { skip }, async () => {
  const inside = await resolveRetainedWindow(ctx, { ownerId: accounts.free.userId, timezone: "UTC", query: { period: "last_7_days" }, now: now.getTime() });
  assert.equal(inside.retention.clamped, false);
  assert.equal(inside.to - inside.from, 7 * 86_400);

  const before = await resolveRetainedWindow(ctx, { ownerId: accounts.free.userId, timezone: "UTC", query: { period: "custom", from: "2020-01-01", to: "2020-02-01" }, now: now.getTime() });
  assert.equal(before.retention.empty, true);
  assert.equal(before.from, before.to);
  assert.equal(before.from, floorFor(90));
});

test("retention: `all_time` on Free is 90 days; on Business it is 1095", { skip }, async () => {
  const free = await resolveRetainedWindow(ctx, { ownerId: accounts.free.userId, timezone: "UTC", query: { period: "all_time" }, now: now.getTime() });
  assert.equal(free.from, floorFor(90));
  const business = await resolveRetainedWindow(ctx, { ownerId: accounts.business.userId, timezone: "UTC", query: { period: "all_time" }, now: now.getTime() });
  assert.equal(business.from, floorFor(1095));
  assert.ok(business.from < free.from);
});

test("retention through the API: top-stats on Free with an ancient `from` starts at the floor, and the comparison window cannot reach past it either", { skip }, async () => {
  const site = await prisma.website.findUniqueOrThrow({ where: { id: accounts.free.siteId }, select: { timezone: true } });
  const floor = retentionFloor({ retentionDays: 90, timezone: site.timezone });
  const r = await call("GET", `/api/v1/${accounts.free.siteId}/top-stats?period=custom&from=2000-01-01&to=2030-01-01`, accounts.free);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const data = r.body.data as { from: number; to: number; comparing_from: number; comparing_to: number };
  assert.equal(data.from, floor, "from clamped to the floor");
  assert.equal(data.comparing_from, floor, "comparison never earlier than the floor");
  assert.equal(data.comparing_to, floor, "comparison collapses to empty when it would precede the floor");
  const meta = r.body.meta as { retention: { days: number; floor: number; clamped: boolean; empty: boolean } };
  assert.deepEqual(meta.retention, { days: 90, floor, clamped: true, empty: false });
});

test("retention through the API: an expired trial is back to 90 days, a paid account keeps its plan's retention", { skip }, async () => {
  const site = await prisma.website.findUniqueOrThrow({ where: { id: accounts.expiredTrial.siteId }, select: { timezone: true } });
  const expired = await call("GET", `/api/v1/${accounts.expiredTrial.siteId}/journeys?period=all_time`, accounts.expiredTrial);
  expectDenied(expired, "journeys");
  const stats = await call("GET", `/api/v1/${accounts.expiredTrial.siteId}/top-stats?period=all_time`, accounts.expiredTrial);
  assert.equal((stats.body.meta as { retention: { days: number } }).retention.days, 90);
  assert.equal((stats.body.data as { from: number }).from, retentionFloor({ retentionDays: 90, timezone: site.timezone }));
  const growth = await call("GET", `/api/v1/${accounts.growth.siteId}/top-stats?period=all_time`, accounts.growth);
  assert.equal((growth.body.meta as { retention: { days: number } }).retention.days, 730);
});
