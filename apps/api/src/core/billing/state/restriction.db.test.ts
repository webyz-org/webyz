/**
 * Restriction precedence through the real writers, against Postgres.
 * Run with RUN_DB_TESTS=1.
 *
 * Every flow that can change a blocking fact (payment webhooks, grace expiry,
 * spend-cap enforcement, a cap change, a new period, trial start, site
 * creation) is driven here in the combinations the audit flagged, and the
 * outcome is checked on both the subscription row and the sites. The claim
 * under test: whichever writer ran last, ingest is blocked iff a blocking
 * condition holds, and the subscription and its sites always agree.
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
import { expirePaymentGrace, markPaymentFailed, markPaymentSucceeded } from "../subscription/lifecycle.service.js";
import { setSpendCap } from "../spend-cap/spend-cap.service.js";
import { startTrial } from "../trial/trial.service.js";
import { createWebsite } from "../../website/website.service.js";
import { reconcileRestriction } from "./restriction.service.js";

const RUN = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const skip = RUN ? false : "set RUN_DB_TESTS=1 with DATABASE_URL to run";

const marker = `restrict-${randomUUID().slice(0, 8)}`;
const userIds: string[] = [];
const DAY = 86_400_000;
const now = new Date();
const start = new Date(now.getTime() - 10 * DAY);
const end = new Date(now.getTime() + 20 * DAY);
const noRedis = { get: async () => null, setex: async () => "OK", del: async () => 1 } as unknown as Redis;
let ctx: AppContext;

/** Growth: 500k included, 1900c base, 2c per 1k overage, default cap 2x base = 3800c. */
const OVER_CAP = 500_000 + 1_000_000; // 1000 units x 2c = 2000c overage -> 3900c >= 3800c
const UNDER_CAP = 500_000 + 100_000; // 200c overage -> 2100c
const HUGE_CAP = 1_000_000;

const seed = async (label: string, opts: { total: number; planCode?: "growth" | "free"; paid?: boolean; status?: "ACTIVE" | "TRIALING" }) => {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: opts.planCode ?? "growth" } });
  const user = await prisma.user.create({ data: { name: `${marker} ${label}`, email: `${marker}-${label}@example.test`, provider: "email" } });
  userIds.push(user.id);
  const sites = [];
  for (let i = 0; i < 2; i++) {
    sites.push(await prisma.website.create({ data: { name: `${label}${i}`, domain: `${marker}-${label}-${i}.example.test`, userId: user.id } }));
  }
  const paid = opts.paid ?? true;
  const sub = await prisma.subscription.create({
    data: {
      userId: user.id,
      planId: plan.id,
      status: opts.status ?? "ACTIVE",
      billingCycle: "MONTHLY",
      providerSubscriptionId: paid ? `sub_${marker}_${label}` : null,
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
  return { user, sites, sub, period, plan, providerId: sub.providerSubscriptionId! };
};

/** The subscription row and the sites' blocked flags, asserted together. */
const state = async (subId: string, userId: string) => {
  const s = await prisma.subscription.findUniqueOrThrow({ where: { id: subId } });
  const sites = await prisma.website.findMany({ where: { userId }, select: { isBlocked: true, blockedAt: true } });
  const blockedFlags = new Set(sites.map((w) => w.isBlocked));
  assert.equal(blockedFlags.size, 1, "every site of the account carries the same blocked flag");
  const blocked = sites[0].isBlocked;
  assert.equal(blocked, s.restriction !== "NONE", `sites blocked=${blocked} must agree with restriction=${s.restriction}`);
  return { restriction: s.restriction, restrictedAt: s.restrictedAt, status: s.status, graceEndsAt: s.graceEndsAt, blocked, blockedAt: sites[0].blockedAt };
};

const enforce = (subId: string) => enforceUsageLimits({ subscriptionIds: [subId] });

before(async () => {
  if (!RUN) return;
  ctx = { prisma, redis: noRedis, clickhouse: {} as ClickHouseClient };
  for (const code of ["free", "growth"] as const) {
    const def = PLAN_CATALOG.find((p) => p.code === code)!;
    await prisma.plan.upsert({ where: { code }, update: {}, create: planRowFromCatalog(def, 0) });
  }
});

after(async () => {
  await closeRedis();
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
  await clickhouse.close().catch(() => {});
});

test("1. cap reached, then payment fails: SPEND_CAP through grace, PAYMENT_FAILED once grace lapses", { skip }, async () => {
  const { user, sub, providerId } = await seed("t1", { total: OVER_CAP });
  await enforce(sub.id);
  assert.equal((await state(sub.id, user.id)).restriction, "SPEND_CAP");

  await markPaymentFailed(ctx, providerId, now);
  let s = await state(sub.id, user.id);
  assert.equal(s.status, "PAST_DUE");
  assert.equal(s.restriction, "SPEND_CAP", "grace is running, the cap is what blocks");
  assert.equal(s.blocked, true);

  const restricted = await expirePaymentGrace(ctx, new Date(now.getTime() + 15 * DAY));
  assert.deepEqual(restricted, [sub.id], "a cap-restricted row is re-evaluated when its grace lapses");
  s = await state(sub.id, user.id);
  assert.equal(s.restriction, "PAYMENT_FAILED");
  assert.equal(s.blocked, true);
});

test("2. payment failed past grace, cap raised: stays PAYMENT_FAILED and blocked, the cap change says so", { skip }, async () => {
  const { user, sub, providerId } = await seed("t2", { total: OVER_CAP });
  await enforce(sub.id);
  await markPaymentFailed(ctx, providerId, new Date(now.getTime() - 20 * DAY)); // grace lapsed 6 days ago
  await expirePaymentGrace(ctx, now);
  assert.equal((await state(sub.id, user.id)).restriction, "PAYMENT_FAILED");

  const r = await setSpendCap(ctx, user.id, HUGE_CAP);
  assert.equal(r.restrictionLifted, false);
  assert.match(r.message, /outstanding invoice/);
  const s = await state(sub.id, user.id);
  assert.equal(s.restriction, "PAYMENT_FAILED");
  assert.equal(s.blocked, true);
});

test("3. payment recovered while the cap is still reached: ACTIVE but SPEND_CAP, still blocked", { skip }, async () => {
  const { user, sub, providerId } = await seed("t3", { total: OVER_CAP });
  // A payment_failed event from 20 days ago delivered now: the grace it opened has already lapsed,
  // and the decision is made at wall time, so it restricts immediately without waiting for the job.
  await markPaymentFailed(ctx, providerId, new Date(now.getTime() - 20 * DAY));
  assert.equal((await state(sub.id, user.id)).restriction, "PAYMENT_FAILED", "late webhook: lapsed grace judged at wall time");
  assert.deepEqual(await expirePaymentGrace(ctx, now), [], "nothing left for the job to do");

  await markPaymentSucceeded(ctx, providerId);
  const s = await state(sub.id, user.id);
  assert.equal(s.status, "ACTIVE");
  assert.equal(s.graceEndsAt, null);
  assert.equal(s.restriction, "SPEND_CAP", "paying does not lift a cap the period has already hit");
  assert.equal(s.blocked, true);
});

test("4. cap reached while payment grace is active: SPEND_CAP, grace untouched", { skip }, async () => {
  const { user, sub, providerId } = await seed("t4", { total: OVER_CAP });
  await markPaymentFailed(ctx, providerId, now);
  // The payment webhook's own reconcile already sees the cap fact: SPEND_CAP, not grace, is what blocks.
  assert.equal((await state(sub.id, user.id)).restriction, "SPEND_CAP");
  await enforce(sub.id);
  const s = await state(sub.id, user.id);
  assert.equal(s.restriction, "SPEND_CAP");
  assert.equal(s.status, "PAST_DUE");
  assert.ok(s.graceEndsAt && s.graceEndsAt > now, "grace deadline preserved");
});

test("5. cap reached after grace expired: PAYMENT_FAILED wins, enforcement does not demote it", { skip }, async () => {
  const { user, sub, providerId } = await seed("t5", { total: OVER_CAP });
  await markPaymentFailed(ctx, providerId, new Date(now.getTime() - 20 * DAY));
  await expirePaymentGrace(ctx, now);
  const before = await state(sub.id, user.id);
  assert.equal(before.restriction, "PAYMENT_FAILED");
  await enforce(sub.id);
  const s = await state(sub.id, user.id);
  assert.equal(s.restriction, "PAYMENT_FAILED");
  assert.equal(s.restrictedAt?.getTime(), before.restrictedAt?.getTime(), "restrictedAt is not rewritten while the restriction stands");
  // The cap still counts as a reason, so its email is not lost.
  const kinds = (await prisma.billingNotification.findMany({ where: { subscriptionId: sub.id } })).map((n) => n.kind);
  assert.ok(kinds.includes("spend_cap_reached"));
  assert.ok(kinds.includes("payment_failed"));
});

test("6. a new period opens while payment is still failed: remains blocked; paying then lifts everything", { skip }, async () => {
  const { user, sub, providerId, period, plan } = await seed("t6", { total: OVER_CAP });
  await enforce(sub.id);
  await markPaymentFailed(ctx, providerId, new Date(now.getTime() - 20 * DAY));
  await expirePaymentGrace(ctx, now);
  assert.equal((await state(sub.id, user.id)).restriction, "PAYMENT_FAILED");

  // Roll: the old period closes, a fresh one opens with nothing used.
  await prisma.billingPeriodUsage.update({ where: { id: period.id }, data: { status: "CLOSED", closedAt: now, periodEnd: new Date(now.getTime() - DAY) } });
  await prisma.billingPeriodUsage.create({
    data: { subscriptionId: sub.id, periodStart: new Date(now.getTime() - DAY), periodEnd: end, includedEvents: BigInt(plan.eventLimit), totalEvents: BigInt(0), overageEvents: BigInt(0) },
  });
  await enforce(sub.id);
  let s = await state(sub.id, user.id);
  assert.equal(s.restriction, "PAYMENT_FAILED", "a fresh allowance does not reopen ingest for a non-paying account");
  assert.equal(s.blocked, true);

  await markPaymentSucceeded(ctx, providerId);
  s = await state(sub.id, user.id);
  assert.equal(s.restriction, "NONE");
  assert.equal(s.blocked, false);
});

test("7. raising the cap inside grace lifts SPEND_CAP; raising it after grace does not", { skip }, async () => {
  const inside = await seed("t7a", { total: OVER_CAP });
  await markPaymentFailed(ctx, inside.providerId, now);
  await enforce(inside.sub.id);
  assert.equal((await state(inside.sub.id, inside.user.id)).restriction, "SPEND_CAP");
  const lifted = await setSpendCap(ctx, inside.user.id, HUGE_CAP);
  assert.equal(lifted.restrictionLifted, true);
  assert.equal((await state(inside.sub.id, inside.user.id)).restriction, "NONE", "grace still allows ingest, so the raised cap lifts the block");

  const after = await seed("t7b", { total: OVER_CAP });
  await enforce(after.sub.id);
  await markPaymentFailed(ctx, after.providerId, new Date(now.getTime() - 20 * DAY));
  await expirePaymentGrace(ctx, now);
  const kept = await setSpendCap(ctx, after.user.id, HUGE_CAP);
  assert.equal(kept.restrictionLifted, false);
  assert.equal((await state(after.sub.id, after.user.id)).restriction, "PAYMENT_FAILED");
});

test("8. payment recovered after a cap restriction, cap no longer reached: fully lifted", { skip }, async () => {
  const { user, sub, providerId } = await seed("t8", { total: OVER_CAP });
  await enforce(sub.id);
  await markPaymentFailed(ctx, providerId, new Date(now.getTime() - 20 * DAY));
  await expirePaymentGrace(ctx, now);
  await setSpendCap(ctx, user.id, HUGE_CAP);
  assert.equal((await state(sub.id, user.id)).restriction, "PAYMENT_FAILED");
  await markPaymentSucceeded(ctx, providerId);
  const s = await state(sub.id, user.id);
  assert.equal(s.restriction, "NONE");
  assert.equal(s.blocked, false);
  assert.equal(s.blockedAt, null);
});

test("9. repeated enforcement and grace runs are idempotent: same restriction, same timestamps", { skip }, async () => {
  const { user, sub, providerId } = await seed("t9", { total: OVER_CAP });
  await enforce(sub.id);
  await markPaymentFailed(ctx, providerId, new Date(now.getTime() - 20 * DAY));
  await expirePaymentGrace(ctx, now);
  const first = await state(sub.id, user.id);
  assert.equal(first.restriction, "PAYMENT_FAILED");
  for (let i = 0; i < 3; i++) {
    await enforce(sub.id);
    assert.deepEqual(await expirePaymentGrace(ctx, now), [], "already restricted for non-payment: nothing to do");
    const r = await reconcileRestriction(ctx, user.id, now);
    assert.equal(r.changed, false);
    assert.deepEqual(await state(sub.id, user.id), first);
  }
});

test("10. ordering: every permutation of the writers converges on the decision over the final facts", { skip }, async () => {
  // A = payment failed with a lapsed grace, B = enforcement, C = grace expiry, D = cap set to its default.
  type Op = "A" | "B" | "C" | "D";
  const run = async (op: Op, s: Awaited<ReturnType<typeof seed>>) => {
    if (op === "A") await markPaymentFailed(ctx, s.providerId, new Date(now.getTime() - 20 * DAY));
    if (op === "B") await enforce(s.sub.id);
    if (op === "C") await expirePaymentGrace(ctx, now);
    if (op === "D") await setSpendCap(ctx, s.user.id, 3_800);
  };
  const permutations = (ops: Op[]): Op[][] =>
    ops.length <= 1 ? [ops] : ops.flatMap((o, i) => permutations([...ops.slice(0, i), ...ops.slice(i + 1)]).map((rest) => [o, ...rest]));
  let n = 0;
  for (const order of permutations(["A", "B", "C", "D"])) {
    const s = await seed(`t10-${n++}`, { total: OVER_CAP });
    for (const op of order) await run(op, s);
    const final = await state(s.sub.id, s.user.id);
    assert.equal(final.restriction, "PAYMENT_FAILED", `order ${order.join("")}`);
    assert.equal(final.blocked, true, `order ${order.join("")}`);
  }
  assert.equal(n, 24);

  // Same idea with the cap in play but payment fine: every order ends SPEND_CAP.
  const capOnly: Op[][] = [["B", "D"], ["D", "B"]];
  for (const order of capOnly) {
    const s = await seed(`t10c-${n++}`, { total: OVER_CAP });
    for (const op of order) await run(op, s);
    assert.equal((await state(s.sub.id, s.user.id)).restriction, "SPEND_CAP", `order ${order.join("")}`);
  }
});

test("a site created under a restricted account is created blocked", { skip }, async () => {
  const { user, sub, providerId } = await seed("site", { total: UNDER_CAP });
  await markPaymentFailed(ctx, providerId, new Date(now.getTime() - 20 * DAY));
  await expirePaymentGrace(ctx, now);
  const w = await createWebsite(ctx, user.id, { name: "new", domain: `${marker}-new.example.test`, timezone: "UTC" });
  assert.equal(w.isBlocked, true);
  assert.equal((await prisma.website.findUniqueOrThrow({ where: { id: w.id } })).isBlocked, true);
  await markPaymentSucceeded(ctx, providerId);
  assert.equal((await prisma.website.findUniqueOrThrow({ where: { id: w.id } })).isBlocked, false);
});

test("free quota block lifts when a trial starts, and the trial's allowance is its own hard limit", { skip }, async () => {
  const free = await seed("trial", { total: 1_000_000, planCode: "free", paid: false });
  await enforce(free.sub.id);
  assert.equal((await state(free.sub.id, free.user.id)).restriction, "FREE_QUOTA");
  const trial = await startTrial(ctx, free.user.id, now);
  assert.ok(trial);
  const s = await prisma.subscription.findUniqueOrThrow({ where: { id: trial!.id } });
  assert.equal(s.restriction, "NONE");
  assert.equal(await prisma.website.count({ where: { userId: free.user.id, isBlocked: true } }), 0, "fresh allowance: sites back on");
});
