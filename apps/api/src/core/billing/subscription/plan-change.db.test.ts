/**
 * Plan changes, cancellation preview and payment emails against real Postgres
 * with the fake provider. Run with RUN_DB_TESTS=1.
 */
import "dotenv/config";
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../generated/prisma/client.js";
import type { AppContext } from "../../../lib/context.js";
import { PLAN_CATALOG, planRowFromCatalog } from "../catalog/index.js";
import { FakeBillingProvider } from "../provider/fake.provider.js";
import { setBillingProvider } from "../provider/index.js";
import { cancelSubscription } from "../billing.service.js";
import { endSubscription, markPaymentFailed, markPaymentSucceeded, syncSubscription } from "./lifecycle.service.js";
import { cancelPendingChange, previewCancellation, previewPlanChange, requestPlanChange } from "./plan-change.service.js";

const RUN = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const skip = RUN ? false : "set RUN_DB_TESTS=1 with DATABASE_URL to run";

const d = (s: string) => new Date(s);
const NOW = d("2026-09-06T12:00:00Z");
const noRedis = { get: async () => null, setex: async () => "OK", del: async () => 1 } as unknown as Redis;

let prisma: PrismaClient;
let ctx: AppContext;
let fake: FakeBillingProvider;
let userId: string;
let customerId: string;
const marker = `change-${randomUUID()}`;
const P = {
  starterM: `p_starter_m_${marker}`, starterY: `p_starter_y_${marker}`,
  growthM: `p_growth_m_${marker}`, growthY: `p_growth_y_${marker}`,
  businessM: `p_business_m_${marker}`, businessY: `p_business_y_${marker}`,
};
const ids: Record<string, string> = {};
let saved: { code: string; m: string | null; y: string | null }[] = [];
const siteIds: string[] = [];

before(async () => {
  if (!RUN) return;
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  ctx = { prisma, redis: noRedis, clickhouse: {} as never };
  for (const code of ["free", "starter", "growth", "business"] as const) {
    const def = PLAN_CATALOG.find((p) => p.code === code)!;
    const row = await prisma.plan.upsert({ where: { code }, update: {}, create: planRowFromCatalog(def, 0) });
    ids[code] = row.id;
  }
  saved = (await prisma.plan.findMany({ where: { code: { in: ["starter", "growth", "business"] } } })).map((p) => ({ code: p.code, m: p.providerPriceMonthlyId, y: p.providerPriceYearlyId }));
  await prisma.plan.update({ where: { code: "starter" }, data: { providerPriceMonthlyId: P.starterM, providerPriceYearlyId: P.starterY } });
  await prisma.plan.update({ where: { code: "growth" }, data: { providerPriceMonthlyId: P.growthM, providerPriceYearlyId: P.growthY } });
  await prisma.plan.update({ where: { code: "business" }, data: { providerPriceMonthlyId: P.businessM, providerPriceYearlyId: P.businessY } });

  const user = await prisma.user.create({ data: { name: marker, email: `${marker}@example.test`, provider: "email" } });
  userId = user.id;
  // Twelve sites: more than Starter's 3 and Growth's 10, fewer than Business's 25.
  for (let i = 0; i < 12; i++) {
    const w = await prisma.website.create({ data: { name: `s${i}`, domain: `${marker}-${i}.example.test`, userId, createdAt: new Date(NOW.getTime() + i * 60_000) } });
    siteIds.push(w.id);
  }
});

beforeEach(async () => {
  if (!RUN) return;
  fake = new FakeBillingProvider({ now: () => NOW });
  for (const [key, price] of Object.entries(P)) fake.registerPrice(price, key.endsWith("Y") ? "year" : "month");
  setBillingProvider(fake);
  await prisma.subscription.deleteMany({ where: { userId } });
  await prisma.website.updateMany({ where: { userId }, data: { isActive: true, restrictionReason: null, isBlocked: false } });
  ({ customerId } = await fake.createCustomer({ email: `${marker}@example.test`, userId }));
  await prisma.user.update({ where: { id: userId }, data: { providerCustomerId: customerId } });
});

after(async () => {
  if (!RUN) return;
  setBillingProvider(null);
  for (const s of saved) await prisma.plan.update({ where: { code: s.code }, data: { providerPriceMonthlyId: s.m, providerPriceYearlyId: s.y } });
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect();
});

const live = () => prisma.subscription.findFirstOrThrow({ where: { userId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID"] } }, include: { plan: true } });
const activeCount = () => prisma.website.count({ where: { userId, isActive: true } });
const kinds = (subscriptionId: string) => prisma.billingNotification.findMany({ where: { subscriptionId }, orderBy: { sentAt: "asc" } }).then((r) => r.map((n) => n.kind));

const startOn = async (base: string, planId: string, cycle: "MONTHLY" | "YEARLY") => {
  const s = fake.completeCheckout({ customerId, basePriceId: base, metadata: { userId, planId, billingCycle: cycle }, start: d("2026-09-05T00:00:00Z") });
  await syncSubscription(ctx, fake, s);
  return s;
};

test("preview: downgrade lists lost limits and features, sites that would go inactive (oldest kept), and the effective date", { skip }, async () => {
  await startOn(P.growthM, ids.growth, "MONTHLY");
  const p = await previewPlanChange(ctx, userId, { planId: ids.starter, billingCycle: "MONTHLY" });
  assert.equal(p.kind, "downgrade");
  assert.equal(p.effective, "base_period_end");
  assert.equal(p.effectiveAt, "2026-10-05T00:00:00.000Z");
  assert.equal(p.sites.limitAfter, 3);
  assert.equal(p.sites.wouldGoInactive.length, 12 - 3);
  // Oldest three stay: the ones that would go inactive are the 9 newest.
  const keptIds = new Set(siteIds.slice(0, 3));
  assert.ok(p.sites.wouldGoInactive.every((s) => !keptIds.has(s.id)));
  assert.ok(p.diff.featuresLost.some((f) => f.key === "journeys"));
  assert.ok(p.diff.limits.some((l) => l.key === "events_per_period" && l.from === 500_000 && l.to === 100_000));
  assert.ok(p.notes.some((n) => n.includes("current period ends")));
  assert.ok(p.notes.some((n) => n.includes("stop collecting new data")));

  const up = await previewPlanChange(ctx, userId, { planId: ids.business, billingCycle: "MONTHLY" });
  assert.equal(up.kind, "upgrade");
  assert.equal(up.effective, "now");
  assert.deepEqual(up.sites.wouldGoInactive, []);
  assert.ok(up.notes.some((n) => n.includes("prorated")));
});

test("downgrade is scheduled at the base period end, undoable, and applied by the provider with site reconciliation", { skip }, async () => {
  const s = await startOn(P.growthM, ids.growth, "MONTHLY");
  const r = await requestPlanChange(ctx, fake, userId, { planId: ids.starter, billingCycle: "MONTHLY" });
  assert.equal(r.applied, "scheduled");
  assert.equal(
    fake.calls.filter((c) => c.method === "changePlan" && (c.args[0] as { billing: string }).billing === "prorate_now").length,
    0,
    "nothing is charged now",
  );
  const deferCalls = fake.calls.filter((c) => c.method === "changePlan" && (c.args[0] as { billing: string }).billing === "defer");
  assert.equal(deferCalls.length, 1, "the provider is told to bill the new price from the next renewal");
  let sub = await live();
  assert.equal(sub.plan.code, "growth", "still on Growth");
  assert.equal(sub.pendingPlanId, ids.starter);
  assert.equal(sub.pendingBillingCycle, "MONTHLY");
  assert.equal(sub.pendingChangeAt?.toISOString(), "2026-10-05T00:00:00.000Z");
  assert.equal(await activeCount(), 12, "nothing changes yet");
  assert.ok((await kinds(sub.id)).includes("subscription_changed"), "scheduled email sent");

  // Undo: the provider goes back to the current plan's price, pending cleared.
  await cancelPendingChange(ctx, fake, userId);
  sub = await live();
  assert.equal(sub.pendingPlanId, null);
  assert.equal(sub.plan.code, "growth");
  assert.equal(fake.subscriptions.get(s.id)!.items[0].priceId, P.growthM, "provider back on the Growth price");
  await assert.rejects(cancelPendingChange(ctx, fake, userId), /no scheduled plan change/);

  // Schedule again, then let the period end arrive: the provider renews on the
  // new price and the sync stops pinning the old plan.
  await requestPlanChange(ctx, fake, userId, { planId: ids.starter, billingCycle: "MONTHLY" });
  const applied = d("2026-10-05T00:00:01Z");
  await syncSubscription(ctx, fake, fake.renew(s.id, applied), undefined, { now: applied });
  sub = await live();
  assert.equal(sub.plan.code, "starter");
  assert.equal(sub.pendingPlanId, null);
  assert.equal(await activeCount(), 3, "oldest three sites remain active");
  const inactive = await prisma.website.findMany({ where: { userId, isActive: false } });
  assert.equal(inactive.length, 9);
  assert.ok(inactive.every((w) => w.restrictionReason === "PLAN_CHANGE"));
  assert.equal(await prisma.website.count({ where: { userId } }), 12, "nothing deleted");
  const k = await kinds(sub.id);
  // Re-scheduling the identical change (same plan, cycle and date) is not a new
  // event, so it does not email again: one for the schedule, one when applied.
  assert.equal(k.filter((x) => x === "subscription_changed").length, 2, "scheduled once, applied once");
});

test("upgrade applies now with proration and reactivates inactive sites that fit", { skip }, async () => {
  const s = await startOn(P.starterM, ids.starter, "MONTHLY");
  await prisma.website.updateMany({ where: { id: { in: siteIds.slice(3) } }, data: { isActive: false, restrictionReason: "PLAN_CHANGE" } });
  assert.equal(await activeCount(), 3);

  const r = await requestPlanChange(ctx, fake, userId, { planId: ids.growth, billingCycle: "MONTHLY" });
  assert.equal(r.applied, "now");
  assert.equal(fake.calls.filter((c) => c.method === "changePlan").length, 1);
  assert.equal(fake.invoices.size, 1, "proration invoice produced");
  const sub = await live();
  assert.equal(sub.plan.code, "growth");
  assert.equal(await activeCount(), 10, "Growth allows 10: seven oldest inactive sites reactivated");
  assert.equal(sub.providerSubscriptionId, s.id);
});

test("an upgrade supersedes a pending downgrade", { skip }, async () => {
  await startOn(P.growthM, ids.growth, "MONTHLY");
  await requestPlanChange(ctx, fake, userId, { planId: ids.starter, billingCycle: "MONTHLY" });
  assert.ok((await live()).pendingPlanId);
  await requestPlanChange(ctx, fake, userId, { planId: ids.business, billingCycle: "MONTHLY" });
  const sub = await live();
  assert.equal(sub.plan.code, "business");
  assert.equal(sub.pendingPlanId, null);
  assert.equal(sub.billingCycle, "MONTHLY");
});

test("monthly to annual is an upgrade applied now; annual to monthly is scheduled", { skip }, async () => {
  await startOn(P.growthM, ids.growth, "MONTHLY");
  const up = await requestPlanChange(ctx, fake, userId, { planId: ids.growth, billingCycle: "YEARLY" });
  assert.equal(up.applied, "now");
  assert.equal((await live()).billingCycle, "YEARLY");
  const down = await requestPlanChange(ctx, fake, userId, { planId: ids.growth, billingCycle: "MONTHLY" });
  assert.equal(down.applied, "scheduled");
  assert.equal((await live()).billingCycle, "YEARLY");
  assert.equal((await live()).pendingBillingCycle, "MONTHLY");
  await assert.rejects(requestPlanChange(ctx, fake, userId, { planId: ids.growth, billingCycle: "YEARLY" }), /already on that plan/);
});

test("cancellation preview and cancel: access until the base end, one email, then Free with sites reconciled", { skip }, async () => {
  const s = await startOn(P.growthY, ids.growth, "YEARLY");
  const p = await previewCancellation(ctx, userId);
  assert.equal(p.accessUntil, "2027-09-05T00:00:00.000Z");
  assert.equal(p.fallback.sites, 1);
  assert.equal(p.sitesThatWouldGoInactive.length, 11);
  assert.ok(p.featuresLost.some((f) => f.key === "funnels"));
  assert.ok(p.notes.some((n) => n.includes("No refund")));

  const sub = await live();
  await cancelSubscription(ctx, fake, userId);
  assert.deepEqual((await kinds(sub.id)).filter((k) => k === "subscription_canceled"), ["subscription_canceled"]);
  await cancelSubscription(ctx, fake, userId);
  assert.equal((await kinds(sub.id)).filter((k) => k === "subscription_canceled").length, 1, "same cancel date, no second email");
  assert.equal(await activeCount(), 12, "nothing restricted while access continues");

  fake.renew(s.id, d("2027-09-05T00:00:01Z"));
  await endSubscription(ctx, s.id);
  assert.equal((await live()).plan.isFree, true);
  assert.equal(await activeCount(), 1, "free allows one site: the oldest stays active");
  assert.equal(await prisma.website.count({ where: { userId } }), 12);
});

test("payment failed and recovered emails go out once per grace window", { skip }, async () => {
  const s = await startOn(P.growthM, ids.growth, "MONTHLY");
  const sub = await live();
  await markPaymentFailed(ctx, s.id, NOW);
  await markPaymentFailed(ctx, s.id, new Date(NOW.getTime() + 86_400_000));
  assert.deepEqual((await kinds(sub.id)).filter((k) => k.startsWith("payment")), ["payment_failed"]);
  await markPaymentSucceeded(ctx, s.id);
  await markPaymentSucceeded(ctx, s.id);
  assert.deepEqual((await kinds(sub.id)).filter((k) => k.startsWith("payment")), ["payment_failed", "payment_recovered"]);
});
