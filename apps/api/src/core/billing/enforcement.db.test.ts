/**
 * Quota enforcement against real Postgres. Run with RUN_DB_TESTS=1.
 *
 * The enforcement job walks every open usage period in the database, so these
 * tests seed periods at exact ratios and assert on their own rows only.
 */
import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import prisma from "../../lib/prisma.js";
import { clickhouse } from "../../lib/clickhouse.js";
import { closeRedis } from "../../lib/redis.js";
import { PLAN_CATALOG, planRowFromCatalog } from "./catalog/index.js";
import { enforceUsageLimits } from "./billing-cron.service.js";

const RUN = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const skip = RUN ? false : "set RUN_DB_TESTS=1 with DATABASE_URL to run";

const marker = `enforce-${randomUUID()}`;
const userIds: string[] = [];
const now = new Date();
const start = new Date(now.getTime() - 10 * 86_400_000);
const end = new Date(now.getTime() + 20 * 86_400_000);

const seed = async (label: string, opts: { status: "TRIALING" | "ACTIVE"; planCode: "growth" | "free"; paid: boolean; total: number }) => {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: opts.planCode } });
  const user = await prisma.user.create({ data: { name: `${marker} ${label}`, email: `${marker}-${label}@example.test`, provider: "email" } });
  userIds.push(user.id);
  const site = await prisma.website.create({ data: { name: label, domain: `${marker}-${label}.example.test`, userId: user.id } });
  const sub = await prisma.subscription.create({
    data: {
      userId: user.id,
      planId: plan.id,
      status: opts.status,
      providerSubscriptionId: opts.paid ? `sub_${marker}_${label}` : null,
      trialEndsAt: opts.status === "TRIALING" ? end : null,
      currentPeriodStart: start,
      currentPeriodEnd: end,
    },
  });
  const included = plan.eventLimit;
  await prisma.billingPeriodUsage.create({
    data: {
      subscriptionId: sub.id,
      periodStart: start,
      periodEnd: end,
      includedEvents: BigInt(included),
      totalEvents: BigInt(opts.total),
      overageEvents: BigInt(Math.max(0, opts.total - included)),
    },
  });
  return { user, site, sub, included };
};

before(async () => {
  if (!RUN) return;
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

test("a trial at 100% of the trial plan's allowance is a hard stop: restricted and blocked, no billing", { skip }, async () => {
  const trial = await seed("trial", { status: "TRIALING", planCode: "growth", paid: false, total: 500_000 });
  const paid = await seed("paid", { status: "ACTIVE", planCode: "growth", paid: true, total: 500_000 });
  const free = await seed("free", { status: "ACTIVE", planCode: "free", paid: false, total: 9_000 });

  const scope = { subscriptionIds: [trial.sub.id, paid.sub.id, free.sub.id] };
  await enforceUsageLimits(scope);

  const t = await prisma.subscription.findUniqueOrThrow({ where: { id: trial.sub.id } });
  assert.equal(t.restriction, "FREE_QUOTA");
  assert.equal((await prisma.website.findUniqueOrThrow({ where: { id: trial.site.id } })).isBlocked, true);

  // Same plan, same usage, but a provider subscription exists: overage is billed, never blocked.
  const p = await prisma.subscription.findUniqueOrThrow({ where: { id: paid.sub.id } });
  assert.equal(p.restriction, "NONE");
  assert.equal((await prisma.website.findUniqueOrThrow({ where: { id: paid.site.id } })).isBlocked, false);

  // Free under quota: warned at 90%, not blocked.
  const f = await prisma.subscription.findUniqueOrThrow({ where: { id: free.sub.id } });
  assert.equal(f.restriction, "NONE");
  assert.equal((await prisma.website.findUniqueOrThrow({ where: { id: free.site.id } })).isBlocked, false);
  const fp = await prisma.billingPeriodUsage.findFirstOrThrow({ where: { subscriptionId: free.sub.id } });
  assert.equal(fp.lastWarnedThreshold, 0.9);

  // Period rolls (usage back under): restriction cleared and site unblocked.
  await prisma.billingPeriodUsage.updateMany({ where: { subscriptionId: trial.sub.id }, data: { totalEvents: BigInt(10), overageEvents: BigInt(0) } });
  await enforceUsageLimits(scope);
  assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { id: trial.sub.id } })).restriction, "NONE");
  assert.equal((await prisma.website.findUniqueOrThrow({ where: { id: trial.site.id } })).isBlocked, false);
});
