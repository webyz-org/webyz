/**
 * Spending protection against real Postgres. Run with RUN_DB_TESTS=1.
 */
import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { ClickHouseClient } from "@clickhouse/client";

import prisma from "../../../lib/prisma.js";
import { clickhouse } from "../../../lib/clickhouse.js";
import { closeRedis } from "../../../lib/redis.js";
import type { AppContext } from "../../../lib/context.js";
import { PLAN_CATALOG, planRowFromCatalog } from "../catalog/index.js";
import { enforceUsageLimits } from "../billing-cron.service.js";
import { ensureOpenPeriod } from "../usage/aggregation.service.js";
import { getUsageSummary } from "../usage/usage.service.js";
import { setSpendCap } from "./spend-cap.service.js";

const RUN = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const skip = RUN ? false : "set RUN_DB_TESTS=1 with DATABASE_URL to run";

const marker = `cap-${randomUUID()}`;
const userIds: string[] = [];
const now = new Date();
const start = new Date(now.getTime() - 10 * 86_400_000);
const end = new Date(now.getTime() + 20 * 86_400_000);
const noRedis = { get: async () => null, setex: async () => "OK", del: async () => 1 } as unknown as Redis;
let ctx: AppContext;

const seed = async (label: string, opts: { cycle?: "MONTHLY" | "YEARLY"; paid?: boolean; planCode?: "growth" | "free"; total: number; cap?: number | null }) => {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: opts.planCode ?? "growth" } });
  const user = await prisma.user.create({ data: { name: `${marker} ${label}`, email: `${marker}-${label}@example.test`, provider: "email" } });
  userIds.push(user.id);
  const site = await prisma.website.create({ data: { name: label, domain: `${marker}-${label}.example.test`, userId: user.id } });
  const paid = opts.paid ?? true;
  const sub = await prisma.subscription.create({
    data: {
      userId: user.id,
      planId: plan.id,
      status: "ACTIVE",
      billingCycle: opts.cycle ?? "MONTHLY",
      providerSubscriptionId: paid ? `sub_${marker}_${label}` : null,
      spendCapCents: opts.cap ?? null,
      currentPeriodStart: start,
      currentPeriodEnd: end,
    },
  });
  const period = await prisma.billingPeriodUsage.create({
    data: {
      subscriptionId: sub.id,
      periodStart: start,
      periodEnd: end,
      includedEvents: BigInt(plan.eventLimit),
      totalEvents: BigInt(opts.total),
      overageEvents: BigInt(Math.max(0, opts.total - plan.eventLimit)),
    },
  });
  return { user, site, sub, period, plan };
};

const subRow = (id: string) => prisma.subscription.findUniqueOrThrow({ where: { id } });
const blocked = (userId: string) => prisma.website.count({ where: { userId, isBlocked: true } });
const kinds = (subscriptionId: string) => prisma.billingNotification.findMany({ where: { subscriptionId }, orderBy: { sentAt: "asc" } }).then((r) => r.map((n) => n.kind));

before(async () => {
  if (!RUN) return;
  ctx = { prisma, redis: noRedis, clickhouse: {} as ClickHouseClient };
  for (const code of ["free", "growth"] as const) {
    const def = PLAN_CATALOG.find((p) => p.code === code)!;
    await prisma.plan.upsert({ where: { code }, update: {}, create: planRowFromCatalog(def, 0) });
  }
});

after(async () => {
  // The enforcement service opens the shared Redis client at import time.
  await closeRedis();
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
  await clickhouse.close().catch(() => {});
});

test("setting the cap: bounds, plan eligibility, and the default", { skip }, async () => {
  const { user, sub } = await seed("bounds", { total: 100_000 });
  await assert.rejects(setSpendCap(ctx, user.id, 1_899), /cannot be below your plan's base price/);
  await assert.rejects(setSpendCap(ctx, user.id, -1), /whole number/);
  const r = await setSpendCap(ctx, user.id, 5_000);
  assert.equal(r.effective, "now");
  assert.equal((await subRow(sub.id)).spendCapCents, 5_000);

  const trial = await seed("trial", { total: 100_000, paid: false });
  await assert.rejects(setSpendCap(ctx, trial.user.id, 5_000), /Spending caps apply to paid plans/);
  const free = await seed("free", { total: 1_000, planCode: "free", paid: false });
  await assert.rejects(setSpendCap(ctx, free.user.id, 5_000), /Spending caps apply to paid plans/);

  const summary = await getUsageSummary(ctx, user.id);
  assert.equal(summary.spendCap.capCents, 5_000);
  assert.equal(summary.spendCap.isDefault, false);
  assert.equal(summary.spendCap.minCents, 1_900);
});

test("enforcement: cap reached restricts ingest and emails once; raising the cap lifts it immediately", { skip }, async () => {
  // Growth: 1900 base, 2c/1k, default cap 3800 -> 950k overage events reach it.
  const { user, sub, period } = await seed("reach", { total: 500_000 + 950_000 });
  const scope = { subscriptionIds: [sub.id] };

  await enforceUsageLimits(scope);
  let s = await subRow(sub.id);
  assert.equal(s.restriction, "SPEND_CAP");
  assert.equal(await blocked(user.id), 1);
  assert.ok((await prisma.billingPeriodUsage.findUniqueOrThrow({ where: { id: period.id } })).spendCapTriggeredAt);
  assert.deepEqual((await kinds(sub.id)).filter((k) => k.startsWith("spend_cap")), ["spend_cap_reached"]);

  await enforceUsageLimits(scope);
  assert.deepEqual((await kinds(sub.id)).filter((k) => k.startsWith("spend_cap")), ["spend_cap_reached"], "no repeat email");

  // Raising the cap above the current bill resumes tracking now.
  const r = await setSpendCap(ctx, user.id, 6_000);
  assert.equal(r.effective, "now");
  assert.equal(r.restrictionLifted, true);
  s = await subRow(sub.id);
  assert.equal(s.restriction, "NONE");
  assert.equal(await blocked(user.id), 0);
  assert.equal((await prisma.billingPeriodUsage.findUniqueOrThrow({ where: { id: period.id } })).spendCapTriggeredAt, null);

  // Raising it only to exactly the current bill does not lift (cap is inclusive).
  await enforceUsageLimits(scope);
  assert.equal((await subRow(sub.id)).restriction, "NONE", "6000 > 3800 bill, stays lifted");
});

test("approaching the cap emails once; overage below approaching sends nothing about the cap", { skip }, async () => {
  const { sub } = await seed("approach", { total: 500_000 + 860_000 }); // 1900 + 1720 = 3620 >= 0.9 * 3800
  const scope = { subscriptionIds: [sub.id] };
  await enforceUsageLimits(scope);
  await enforceUsageLimits(scope);
  assert.deepEqual((await kinds(sub.id)).filter((k) => k.startsWith("spend_cap")), ["spend_cap_approaching"]);
  assert.equal((await subRow(sub.id)).restriction, "NONE");

  const quiet = await seed("quiet", { total: 500_000 + 100_000 });
  await enforceUsageLimits({ subscriptionIds: [quiet.sub.id] });
  assert.deepEqual((await kinds(quiet.sub.id)).filter((k) => k.startsWith("spend_cap")), []);
});

test("lowering the cap below what the period already cost defers it; the next period applies it", { skip }, async () => {
  const { user, sub } = await seed("lower", { total: 500_000 + 500_000, cap: 6_000 }); // bill 1900 + 1000 = 2900
  const r = await setSpendCap(ctx, user.id, 2_500);
  assert.equal(r.effective, "next_period");
  assert.equal(r.alreadyExceeded, true);
  assert.equal(r.pendingCents, 2_500);
  assert.equal(r.currentBillCents, 2_900);
  assert.match(r.message, /starts with your next usage period/);
  let s = await subRow(sub.id);
  assert.equal(s.spendCapCents, 6_000, "current cap untouched");
  assert.equal(s.pendingSpendCapCents, 2_500);

  // Enforcement in the meantime does not restrict: the old cap still applies.
  await enforceUsageLimits({ subscriptionIds: [sub.id] });
  assert.equal((await subRow(sub.id)).restriction, "NONE");

  // Lowering to something above the current bill applies immediately.
  const ok = await setSpendCap(ctx, user.id, 3_000);
  assert.equal(ok.effective, "now");
  s = await subRow(sub.id);
  assert.equal(s.spendCapCents, 3_000);
  assert.equal(s.pendingSpendCapCents, null, "an immediate change clears a pending one");

  // Defer again, then roll the period: the pending cap takes effect.
  await setSpendCap(ctx, user.id, 2_500);
  const nextStart = end;
  const nextEnd = new Date(end.getTime() + 30 * 86_400_000);
  await prisma.subscription.update({ where: { id: sub.id }, data: { currentPeriodStart: nextStart, currentPeriodEnd: nextEnd } });
  const ledgerSub = {
    id: sub.id,
    currentPeriodStart: nextStart,
    currentPeriodEnd: nextEnd,
    plan: { entitlements: (await prisma.plan.findUniqueOrThrow({ where: { code: "growth" } })).entitlements },
    user: { websites: [] as { id: string }[] },
  };
  const fakeCh = { query: async () => ({ json: async () => [] }) } as unknown as ClickHouseClient;
  await ensureOpenPeriod({ prisma, clickhouse: fakeCh }, ledgerSub, new Date(nextStart.getTime() + 60_000));
  s = await subRow(sub.id);
  assert.equal(s.spendCapCents, 2_500);
  assert.equal(s.pendingSpendCapCents, null);
});

test("annual: cap measured against the monthly-equivalent base, so the same overage is under the cap", { skip }, async () => {
  const monthly = await seed("m", { total: 500_000 + 950_000 });
  const yearly = await seed("y", { total: 500_000 + 950_000, cycle: "YEARLY" });
  await enforceUsageLimits({ subscriptionIds: [monthly.sub.id, yearly.sub.id] });
  assert.equal((await subRow(monthly.sub.id)).restriction, "SPEND_CAP", "1900 + 1900 = 3800 reaches the cap");
  assert.equal((await subRow(yearly.sub.id)).restriction, "NONE", "1583 + 1900 = 3483 stays under");
  const summary = await getUsageSummary(ctx, yearly.user.id);
  assert.equal(summary.spendCap.monthlyBaseCents, 1_583);
  assert.equal(summary.usage.periodChargesCents, 1_900, "annual period charges are overage only");
  assert.equal(summary.usage.currentBillCents, 1_583 + 1_900);
});
