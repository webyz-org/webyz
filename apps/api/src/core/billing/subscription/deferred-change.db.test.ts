/**
 * Deferred plan changes against Postgres with the fake provider.
 * Run with RUN_DB_TESTS=1.
 *
 * Paddle has no provider-side schedule for an item change, so a downgrade is
 * two facts: the provider swaps the price and bills nothing until the next
 * renewal, and a local pending record keeps entitlements on the plan the
 * customer paid for until its period ends. Under test is what the domain does
 * with that pair: the plan stays pinned while pending, the local record is the
 * only schedule, the apply job moves it across at the boundary, an upgrade
 * supersedes it, an undo puts the provider back, and webhooks converge in any
 * order because the handler re-reads the subscription.
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
import { handlePaddleEvent } from "../provider/paddle.webhooks.js";
import { cancelSubscription, resumeSubscription } from "../billing.service.js";
import { syncSubscription } from "./lifecycle.service.js";
import { applyDuePlanChanges, cancelPendingChange, requestPlanChange } from "./plan-change.service.js";

const RUN = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const skip = RUN ? false : "set RUN_DB_TESTS=1 with DATABASE_URL to run";

const d = (s: string) => new Date(s);
const NOW = d("2026-09-06T12:00:00Z");
const BOUNDARY = d("2026-10-05T00:00:00Z");
const AFTER = d("2026-10-05T00:00:01Z");
const noRedis = { get: async () => null, setex: async () => "OK", del: async () => 1 } as unknown as Redis;

let prisma: PrismaClient;
let ctx: AppContext;
let fake: FakeBillingProvider;
let userId: string;
let customerId: string;
const marker = `defer-${randomUUID().slice(0, 8)}`;
const P = {
  starterM: `pri_starter_m_${marker}`,
  starterY: `pri_starter_y_${marker}`,
  growthM: `pri_growth_m_${marker}`,
  growthY: `pri_growth_y_${marker}`,
  businessM: `pri_business_m_${marker}`,
  businessY: `pri_business_y_${marker}`,
};
const ids: Record<string, string> = {};
let saved: { code: string; m: string | null; y: string | null }[] = [];

before(async () => {
  if (!RUN) return;
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  ctx = { prisma, redis: noRedis, clickhouse: {} as never };
  for (const code of ["free", "starter", "growth", "business"] as const) {
    const def = PLAN_CATALOG.find((p) => p.code === code)!;
    ids[code] = (await prisma.plan.upsert({ where: { code }, update: {}, create: planRowFromCatalog(def, 0) })).id;
  }
  saved = (await prisma.plan.findMany({ where: { code: { in: ["starter", "growth", "business"] } } })).map((p) => ({
    code: p.code,
    m: p.providerPriceMonthlyId,
    y: p.providerPriceYearlyId,
  }));
  await prisma.plan.update({ where: { code: "starter" }, data: { providerPriceMonthlyId: P.starterM, providerPriceYearlyId: P.starterY } });
  await prisma.plan.update({ where: { code: "growth" }, data: { providerPriceMonthlyId: P.growthM, providerPriceYearlyId: P.growthY } });
  await prisma.plan.update({ where: { code: "business" }, data: { providerPriceMonthlyId: P.businessM, providerPriceYearlyId: P.businessY } });
  const user = await prisma.user.create({ data: { name: marker, email: `${marker}@example.test`, provider: "email" } });
  userId = user.id;
  for (let i = 0; i < 5; i++) {
    await prisma.website.create({
      data: { name: `s${i}`, domain: `${marker}-${i}.example.test`, userId, createdAt: new Date(NOW.getTime() + i * 60_000) },
    });
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
  for (const s of saved) {
    await prisma.plan.update({ where: { code: s.code }, data: { providerPriceMonthlyId: s.m, providerPriceYearlyId: s.y } });
  }
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect();
});

const live = () =>
  prisma.subscription.findFirstOrThrow({
    where: { userId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID"] } },
    include: { plan: true },
  });
const activeCount = () => prisma.website.count({ where: { userId, isActive: true } });
const kinds = (subscriptionId: string) =>
  prisma.billingNotification.findMany({ where: { subscriptionId }, orderBy: { sentAt: "asc" } }).then((r) => r.map((n) => n.kind));
const providerPrice = (subId: string) => fake.subscriptions.get(subId)!.items[0].priceId;

/** Growth monthly from 2026-09-05, downgrade to Starter due 2026-10-05. */
const growthWithPendingDowngrade = async () => {
  const s = fake.completeCheckout({
    customerId,
    basePriceId: P.growthM,
    metadata: { userId, planId: ids.growth, billingCycle: "MONTHLY" },
    start: d("2026-09-05T00:00:00Z"),
  });
  await syncSubscription(ctx, fake, s);
  const r = await requestPlanChange(ctx, fake, userId, { planId: ids.starter, billingCycle: "MONTHLY" });
  assert.equal(r.applied, "scheduled");
  return s;
};

test("a downgrade bills nothing now, pins the paid-for plan, and records when it applies", { skip }, async () => {
  const s = await growthWithPendingDowngrade();

  const sub = await live();
  assert.equal(sub.plan.code, "growth", "entitlements stay on what was paid for");
  assert.equal(sub.pendingPlanId, ids.starter);
  assert.equal(sub.pendingBillingCycle, "MONTHLY");
  assert.equal(sub.pendingChangeAt?.toISOString(), BOUNDARY.toISOString());
  assert.equal(await activeCount(), 5, "no site is touched yet");
  assert.ok((await kinds(sub.id)).includes("subscription_changed"), "the customer is told when it applies");

  // The provider carries the new price already: that is how it bills the lower
  // amount at the renewal without charging anything today.
  assert.equal(providerPrice(s.id), P.starterM);
  const charged = fake.calls.filter((c) => c.method === "changePlan" && (c.args[0] as { billing: string }).billing === "prorate_now");
  assert.equal(charged.length, 0);

  // Syncing again before the boundary must not let the provider's price move
  // the local plan across early.
  await syncSubscription(ctx, fake, await fake.getSubscription(s.id), undefined, { now: d("2026-10-04T23:00:00Z") });
  const still = await live();
  assert.equal(still.plan.code, "growth");
  assert.equal(still.pendingPlanId, ids.starter);
});

test("the apply job moves the plan across at the boundary and not before, and is idempotent", { skip }, async () => {
  const s = await growthWithPendingDowngrade();

  const early = await applyDuePlanChanges(ctx, fake, d("2026-10-04T23:59:00Z"));
  assert.equal(early.applied, 0, "nothing is due yet");
  assert.equal((await live()).plan.code, "growth");

  const first = await applyDuePlanChanges(ctx, fake, AFTER);
  assert.equal(first.applied, 1);
  let sub = await live();
  assert.equal(sub.plan.code, "starter");
  assert.equal(sub.pendingPlanId, null);
  assert.equal(sub.pendingChangeAt, null);
  assert.equal(await activeCount(), 3, "Starter allows three sites; the oldest stay active");
  const inactive = await prisma.website.findMany({ where: { userId, isActive: false } });
  assert.equal(inactive.length, 2);
  assert.ok(inactive.every((w) => w.restrictionReason === "PLAN_CHANGE"));
  assert.equal(await prisma.website.count({ where: { userId } }), 5, "nothing deleted");

  // Second run: nothing due, nothing changed, no second email.
  const second = await applyDuePlanChanges(ctx, fake, d("2026-10-05T01:00:00Z"));
  assert.equal(second.applied, 0);
  sub = await live();
  assert.equal(sub.plan.code, "starter");
  assert.equal((await kinds(sub.id)).filter((k) => k === "subscription_changed").length, 2, "scheduled once, applied once");
  assert.equal(providerPrice(s.id), P.starterM);
});

test("the renewal webhook applies it too, so nothing waits on the job", { skip }, async () => {
  const s = await growthWithPendingDowngrade();
  fake.renew(s.id, AFTER);
  await handlePaddleEvent(ctx, fake, { id: `evt_${randomUUID()}`, type: "subscription.updated", createdAt: AFTER, data: { id: s.id } });

  const sub = await live();
  assert.equal(sub.plan.code, "starter");
  assert.equal(sub.pendingPlanId, null);
  assert.equal(sub.basePeriodStart?.toISOString(), BOUNDARY.toISOString());
  assert.equal(sub.basePeriodEnd?.toISOString(), "2026-11-05T00:00:00.000Z");
});

test("a stale webhook cannot undo a newer state, because the handler re-reads the subscription", { skip }, async () => {
  const s = await growthWithPendingDowngrade();
  fake.renew(s.id, AFTER);
  await applyDuePlanChanges(ctx, fake, AFTER);
  assert.equal((await live()).plan.code, "starter");

  // An event whose payload predates the change arrives late. Its body says
  // nothing the handler trusts: it reads the provider instead.
  await handlePaddleEvent(ctx, fake, { id: `evt_${randomUUID()}`, type: "subscription.updated", createdAt: NOW, data: { id: s.id } });
  const sub = await live();
  assert.equal(sub.plan.code, "starter");
  assert.equal(sub.pendingPlanId, null);
  assert.equal(await prisma.subscription.count({ where: { userId, providerSubscriptionId: s.id } }), 1);
});

test("undoing a pending downgrade puts the provider back on the current plan's price", { skip }, async () => {
  const s = await growthWithPendingDowngrade();

  await cancelPendingChange(ctx, fake, userId);
  const sub = await live();
  assert.equal(sub.pendingPlanId, null);
  assert.equal(sub.plan.code, "growth");
  assert.equal(providerPrice(s.id), P.growthM, "the renewal is back at the Growth price");
  await assert.rejects(cancelPendingChange(ctx, fake, userId), /no scheduled plan change/);

  // The boundary passes with nothing pending: the plan stays.
  await applyDuePlanChanges(ctx, fake, AFTER);
  assert.equal((await live()).plan.code, "growth");
});

test("an upgrade supersedes a pending downgrade and applies now", { skip }, async () => {
  const s = await growthWithPendingDowngrade();

  const r = await requestPlanChange(ctx, fake, userId, { planId: ids.business, billingCycle: "MONTHLY" });
  assert.equal(r.applied, "now");
  const sub = await live();
  assert.equal(sub.plan.code, "business");
  assert.equal(sub.pendingPlanId, null);
  assert.equal(providerPrice(s.id), P.businessM);
  assert.equal(await activeCount(), 5, "Business allows all five");

  // The old boundary arrives: there is nothing left to apply.
  await applyDuePlanChanges(ctx, fake, AFTER);
  assert.equal((await live()).plan.code, "business");
});

test("cancelling while a downgrade is pending keeps both facts until the period ends", { skip }, async () => {
  const s = await growthWithPendingDowngrade();

  const c = await cancelSubscription(ctx, fake, userId);
  assert.equal(c.canceledAt?.toISOString(), BOUNDARY.toISOString());
  let sub = await live();
  assert.equal(sub.plan.code, "growth", "still on what was paid for");
  assert.equal(sub.cancelAt?.toISOString(), BOUNDARY.toISOString());
  assert.equal(sub.pendingPlanId, ids.starter, "the downgrade survives, in case the customer resumes");
  assert.equal(await activeCount(), 5, "nothing restricted while access continues");

  // Resuming keeps the downgrade, which is what the customer asked for.
  await resumeSubscription(ctx, fake, userId);
  sub = await live();
  assert.equal(sub.cancelAt, null);
  assert.equal(sub.pendingPlanId, ids.starter);
  await applyDuePlanChanges(ctx, fake, AFTER);
  assert.equal((await live()).plan.code, "starter");
  assert.equal(providerPrice(s.id), P.starterM);
});

test("a pending change the provider never took follows the provider rather than guessing", { skip }, async () => {
  const s = await growthWithPendingDowngrade();
  // The provider was put back to Growth out of band (a dashboard edit, or a
  // failed call we recorded anyway). At the boundary the money says Growth.
  await fake.changePlan({ providerSubscriptionId: s.id, basePriceId: P.growthM, billing: "defer" });

  await applyDuePlanChanges(ctx, fake, AFTER);
  const sub = await live();
  assert.equal(sub.plan.code, "growth", "never bill Starter's entitlements against a Growth charge");
  assert.equal(sub.pendingPlanId, null, "the stale pending record is cleared");
  assert.equal(await activeCount(), 5);
});
