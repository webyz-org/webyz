/**
 * Subscription lifecycle against real Postgres with the fake provider.
 * Run with RUN_DB_TESTS=1. Rows carry a unique marker and are removed after.
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
import type { ProviderInvoice } from "../provider/billing-provider.js";
import { assignFreePlan } from "../free-plan.service.js";
import {
  baseChargedEarly,
  classifyLines,
  endSubscription,
  markPaymentFailed,
  markPaymentSucceeded,
  recordInvoice,
  syncSubscription,
} from "./lifecycle.service.js";
import { cancelSubscription, changePlan, resumeSubscription } from "../billing.service.js";
import { setBillingProvider } from "../provider/index.js";

const RUN = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const skip = RUN ? false : "set RUN_DB_TESTS=1 with DATABASE_URL to run";

const d = (s: string) => new Date(s);
const NOW = d("2026-09-06T12:00:00Z");

/** Redis stand-in: entitlement cache is best-effort, so a no-op client is fine. */
const noRedis = {
  get: async () => null,
  setex: async () => "OK",
  del: async () => 1,
} as unknown as Redis;

let prisma: PrismaClient;
let ctx: AppContext;
let fake: FakeBillingProvider;
let userId: string;
let customerId: string;
const marker = `lifecycle-${randomUUID()}`;
const PRICE = {
  growthMonth: `pri_growth_month_${marker}`,
  growthYear: `pri_growth_year_${marker}`,
  businessMonth: `pri_business_month_${marker}`,
  businessYear: `pri_business_year_${marker}`,
};
let growthId: string;
let businessId: string;
/** Provider price ids the dev database had before this test, restored afterwards. */
let savedPrices: { code: string; m: string | null; y: string | null }[] = [];

before(async () => {
  if (!RUN) return;
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  ctx = { prisma, redis: noRedis, clickhouse: {} as never };

  // Plans exist from the seed; point their provider price ids at this test's fakes.
  for (const code of ["free", "growth", "business"] as const) {
    const def = PLAN_CATALOG.find((p) => p.code === code)!;
    await prisma.plan.upsert({ where: { code }, update: {}, create: planRowFromCatalog(def, 0) });
  }
  savedPrices = (await prisma.plan.findMany({ where: { code: { in: ["growth", "business"] } } })).map((p) => ({
    code: p.code,
    m: p.providerPriceMonthlyId,
    y: p.providerPriceYearlyId,
  }));
  growthId = (await prisma.plan.update({
    where: { code: "growth" },
    data: { providerPriceMonthlyId: PRICE.growthMonth, providerPriceYearlyId: PRICE.growthYear },
  })).id;
  businessId = (await prisma.plan.update({
    where: { code: "business" },
    data: { providerPriceMonthlyId: PRICE.businessMonth, providerPriceYearlyId: PRICE.businessYear },
  })).id;

  const user = await prisma.user.create({ data: { name: marker, email: `${marker}@example.test`, provider: "email" } });
  userId = user.id;
  await prisma.website.create({ data: { name: marker, domain: `${marker}.example.test`, userId, isBlocked: true } });
});

beforeEach(async () => {
  if (!RUN) return;
  fake = new FakeBillingProvider({ now: () => NOW });
  fake.registerPrice(PRICE.growthMonth, "month");
  fake.registerPrice(PRICE.growthYear, "year");
  fake.registerPrice(PRICE.businessMonth, "month");
  fake.registerPrice(PRICE.businessYear, "year");
  setBillingProvider(fake);

  // Reset the user to "on the free plan, site blocked for quota".
  await prisma.subscription.deleteMany({ where: { userId } });
  await prisma.billingInvoice.deleteMany({ where: { subscription: { userId } } });
  const free = await assignFreePlan({ prisma }, userId);
  // The block is fact-backed: an open period at the free allowance. The
  // restriction writer derives the state from facts, so a restriction with no
  // supporting fact would be corrected on the next reconcile.
  await prisma.billingPeriodUsage.deleteMany({ where: { subscription: { userId } } });
  const freePlan = await prisma.plan.findFirstOrThrow({ where: { isFree: true } });
  await prisma.billingPeriodUsage.create({
    data: {
      subscriptionId: free!.id,
      periodStart: new Date(NOW.getTime() - 5 * 86_400_000),
      periodEnd: new Date(NOW.getTime() + 25 * 86_400_000),
      includedEvents: BigInt(freePlan.eventLimit),
      totalEvents: BigInt(freePlan.eventLimit),
    },
  });
  await prisma.subscription.update({ where: { id: free!.id }, data: { restriction: "FREE_QUOTA", restrictedAt: NOW } });
  await prisma.website.updateMany({ where: { userId }, data: { isBlocked: true } });
  ({ customerId } = await fake.createCustomer({ email: `${marker}@example.test`, userId }));
  await prisma.user.update({ where: { id: userId }, data: { providerCustomerId: customerId } });
});

after(async () => {
  if (!RUN) return;
  setBillingProvider(null);
  for (const saved of savedPrices) {
    await prisma.plan.update({
      where: { code: saved.code },
      data: { providerPriceMonthlyId: saved.m, providerPriceYearlyId: saved.y },
    });
  }
  // Invoice rows recorded before their subscription existed have no owner to
  // cascade from, so they are removed by their own marker.
  await prisma.billingInvoice.deleteMany({ where: { providerInvoiceId: { startsWith: `txn_usage_${marker}` } } });
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect();
});

const liveSub = () =>
  prisma.subscription.findFirstOrThrow({
    where: { userId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID"] } },
    include: { plan: true },
  });

test("monthly checkout: one live paid subscription, free row retired, quota block lifted", { skip }, async () => {
  const providerSub = fake.completeCheckout({
    customerId,
    basePriceId: PRICE.growthMonth,
    metadata: { userId, planId: growthId, billingCycle: "MONTHLY" },
    start: d("2026-09-05T00:00:00Z"),
  });
  await syncSubscription(ctx, fake, providerSub);

  const sub = await liveSub();
  assert.equal(sub.plan.code, "growth");
  assert.equal(sub.billingCycle, "MONTHLY");
  assert.equal(sub.providerSubscriptionId, providerSub.id);
  assert.equal(sub.currentPeriodStart?.toISOString(), "2026-09-05T00:00:00.000Z");
  assert.equal(sub.currentPeriodEnd?.toISOString(), "2026-10-05T00:00:00.000Z");
  assert.equal(sub.basePeriodEnd?.toISOString(), "2026-10-05T00:00:00.000Z");
  assert.equal(sub.restriction, "NONE");

  const live = await prisma.subscription.count({ where: { userId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID"] } } });
  assert.equal(live, 1);
  const blocked = await prisma.website.count({ where: { userId, isBlocked: true } });
  assert.equal(blocked, 0);
});

test("annual checkout: the usage period is a local month, the base period is the prepaid year", { skip }, async () => {
  const providerSub = fake.completeCheckout({
    customerId,
    basePriceId: PRICE.growthYear,
    metadata: { userId, planId: growthId, billingCycle: "YEARLY" },
    start: d("2026-09-05T00:00:00Z"),
  });
  await syncSubscription(ctx, fake, providerSub);

  const sub = await liveSub();
  assert.equal(sub.billingCycle, "YEARLY");
  assert.equal(sub.currentPeriodStart?.toISOString(), "2026-09-05T00:00:00.000Z");
  assert.equal(sub.currentPeriodEnd?.toISOString(), "2026-10-05T00:00:00.000Z", "usage period is one month");
  assert.equal(sub.basePeriodStart?.toISOString(), "2026-09-05T00:00:00.000Z");
  assert.equal(sub.basePeriodEnd?.toISOString(), "2027-09-05T00:00:00.000Z", "base period is the year");

  // A redelivered event is a no-op: one row, same periods.
  await syncSubscription(ctx, fake, await fake.getSubscription(providerSub.id));
  assert.equal(await prisma.subscription.count({ where: { userId, providerSubscriptionId: providerSub.id } }), 1);
  assert.equal((await liveSub()).currentPeriodEnd?.toISOString(), "2026-10-05T00:00:00.000Z");
});

test("annual: monthly usage windows follow the clock while the base year stays", { skip }, async () => {
  const providerSub = fake.completeCheckout({ customerId, basePriceId: PRICE.growthYear, metadata: { userId, planId: growthId }, start: d("2026-09-05T00:00:00Z") });
  await syncSubscription(ctx, fake, providerSub);

  // Two months later the provider still reports the same prepaid year, so the
  // monthly window is derived locally rather than waiting for a renewal.
  await syncSubscription(ctx, fake, await fake.getSubscription(providerSub.id), undefined, { now: d("2026-11-10T00:00:00Z") });
  const sub = await liveSub();
  assert.equal(sub.currentPeriodStart?.toISOString(), "2026-11-05T00:00:00.000Z");
  assert.equal(sub.currentPeriodEnd?.toISOString(), "2026-12-05T00:00:00.000Z");
  assert.equal(sub.basePeriodEnd?.toISOString(), "2027-09-05T00:00:00.000Z");
});

test("webhook ordering: a stale snapshot cannot undo a newer one, and never duplicates the row", { skip }, async () => {
  const start = d("2026-09-05T00:00:00Z");
  const providerSub = fake.completeCheckout({ customerId, basePriceId: PRICE.growthYear, metadata: { userId, planId: growthId, billingCycle: "YEARLY" }, start });
  const first = structuredClone(providerSub);
  // The provider moved on: cancellation was scheduled after that snapshot.
  const later = await fake.scheduleCancellation(providerSub.id);

  const orders = [
    [later, first],
    [first, later],
    [later, later, first],
  ];
  for (const order of orders) {
    await prisma.subscription.deleteMany({ where: { userId, providerSubscriptionId: providerSub.id } });
    for (const snapshot of order) await syncSubscription(ctx, fake, snapshot);
    const sub = await liveSub();
    assert.equal(sub.providerSubscriptionId, providerSub.id);
    assert.equal(sub.currentPeriodEnd?.toISOString(), "2026-10-05T00:00:00.000Z");
    assert.equal(sub.basePeriodEnd?.toISOString(), "2027-09-05T00:00:00.000Z");
    assert.equal(await prisma.subscription.count({ where: { userId, providerSubscriptionId: providerSub.id } }), 1);
  }
});

test("a subscription that is already dead is recorded but does not retire the free plan or lift restrictions", { skip }, async () => {
  // A checkout whose first payment never succeeded leaves nothing live: the
  // customer must stay exactly where they were, quota block included.
  const providerSub = fake.completeCheckout({ customerId, basePriceId: PRICE.growthMonth, metadata: { userId, planId: growthId }, status: "canceled" });
  await syncSubscription(ctx, fake, providerSub);
  const rows = await prisma.subscription.findMany({ where: { userId }, include: { plan: true } });
  const free = rows.find((r) => r.plan.isFree)!;
  assert.equal(free.status, "ACTIVE");
  assert.equal(free.restriction, "FREE_QUOTA");
  assert.equal(rows.find((r) => r.providerSubscriptionId === providerSub.id)?.status, "CANCELED");
  assert.equal(await prisma.website.count({ where: { userId, isBlocked: true } }), 1);
});

test("annual cancellation is scheduled for the end of the prepaid year, not the usage month", { skip }, async () => {
  const providerSub = fake.completeCheckout({ customerId, basePriceId: PRICE.growthYear, metadata: { userId, planId: growthId }, start: d("2026-09-05T00:00:00Z") });
  await syncSubscription(ctx, fake, providerSub);

  const result = await cancelSubscription(ctx, fake, userId);
  assert.equal(result.canceledAt?.toISOString(), "2027-09-05T00:00:00.000Z");
  const sub = await liveSub();
  assert.equal(sub.status, "ACTIVE", "still active until the year ends");
  assert.equal(sub.cancelAtPeriodEnd, true);
  assert.equal(sub.cancelAt?.toISOString(), "2027-09-05T00:00:00.000Z");

  // Monthly usage windows keep rolling until then, inside the prepaid year.
  await syncSubscription(ctx, fake, await fake.getSubscription(providerSub.id), undefined, { now: d("2027-03-10T00:00:00Z") });
  assert.equal((await liveSub()).currentPeriodEnd?.toISOString(), "2027-04-05T00:00:00.000Z");

  // Resume clears it.
  await resumeSubscription(ctx, fake, userId);
  assert.equal((await liveSub()).cancelAt, null);

  // When the year actually ends after a cancel, the deleted event puts the user on free.
  await cancelSubscription(ctx, fake, userId);
  fake.renew(providerSub.id, d("2027-09-05T00:00:01Z"));
  await endSubscription(ctx, providerSub.id);
  const after = await liveSub();
  assert.equal(after.plan.isFree, true);
  assert.equal((await prisma.subscription.findUnique({ where: { providerSubscriptionId: providerSub.id } }))?.status, "CANCELED");
});

test("monthly cancellation ends at the month end", { skip }, async () => {
  const providerSub = fake.completeCheckout({ customerId, basePriceId: PRICE.growthMonth, metadata: { userId, planId: growthId }, start: d("2026-09-05T00:00:00Z") });
  await syncSubscription(ctx, fake, providerSub);
  const result = await cancelSubscription(ctx, fake, userId);
  assert.equal(result.canceledAt?.toISOString(), "2026-10-05T00:00:00.000Z");
});

test("monthly to annual: base becomes yearly with proration, usage stays monthly", { skip }, async () => {
  const providerSub = fake.completeCheckout({ customerId, basePriceId: PRICE.growthMonth, metadata: { userId, planId: growthId }, start: d("2026-09-05T00:00:00Z") });
  await syncSubscription(ctx, fake, providerSub);

  await changePlan(ctx, fake, userId, { planId: growthId, billingCycle: "YEARLY" });
  const call = fake.calls.find((c) => c.method === "changePlan")!;
  assert.deepEqual(call.args[0], { providerSubscriptionId: providerSub.id, basePriceId: PRICE.growthYear, billing: "prorate_now" });
  assert.equal(fake.invoices.size, 1, "a proration invoice was produced");

  const sub = await liveSub();
  assert.equal(sub.billingCycle, "YEARLY");
  assert.equal(sub.currentPeriodEnd?.toISOString(), "2026-10-05T00:00:00.000Z", "usage still monthly");
  assert.equal(sub.basePeriodEnd?.toISOString(), "2027-09-05T00:00:00.000Z", "base now yearly from the anchor");
});

test("annual to monthly is a downgrade: scheduled for the year end, applied by the provider then, single live row", { skip }, async () => {
  const providerSub = fake.completeCheckout({ customerId, basePriceId: PRICE.growthYear, metadata: { userId, planId: growthId }, start: d("2026-09-05T00:00:00Z") });
  await syncSubscription(ctx, fake, providerSub);
  const result = await changePlan(ctx, fake, userId, { planId: growthId, billingCycle: "MONTHLY" });
  assert.equal(result.applied, "scheduled");
  let sub = await liveSub();
  assert.equal(sub.billingCycle, "YEARLY", "unchanged until the year ends");
  assert.equal(sub.pendingBillingCycle, "MONTHLY");
  assert.equal(sub.pendingChangeAt?.toISOString(), "2027-09-05T00:00:00.000Z");
  // The provider is already on the monthly price and will bill it at the
  // renewal; the local row keeps the year the customer paid for.
  assert.equal(fake.subscriptions.get(providerSub.id)!.items[0].priceId, PRICE.growthMonth);

  // At the year end the provider renews on the monthly price and the sync
  // stops pinning: the change applies and the pending record clears.
  await syncSubscription(ctx, fake, fake.renew(providerSub.id, d("2027-09-05T00:00:01Z")), undefined, { now: d("2027-09-05T00:00:01Z") });
  sub = await liveSub();
  assert.equal(sub.billingCycle, "MONTHLY");
  assert.equal(sub.pendingPlanId, null);
  assert.equal(sub.pendingChangeAt, null);
  assert.equal(sub.basePeriodEnd?.toISOString(), "2027-10-05T00:00:00.000Z");
  assert.equal(await prisma.subscription.count({ where: { userId, status: "ACTIVE" } }), 1);
});

test("plan upgrade keeps the cycle and swaps both prices", { skip }, async () => {
  const providerSub = fake.completeCheckout({ customerId, basePriceId: PRICE.growthMonth, metadata: { userId, planId: growthId }, start: d("2026-09-05T00:00:00Z") });
  await syncSubscription(ctx, fake, providerSub);
  await changePlan(ctx, fake, userId, { planId: businessId, billingCycle: "MONTHLY" });
  const sub = await liveSub();
  assert.equal(sub.plan.code, "business");
  await assert.rejects(changePlan(ctx, fake, userId, { planId: businessId, billingCycle: "MONTHLY" }), /already on that plan/);
});

test("payment failure opens grace once; success closes it; past due keeps the subscription", { skip }, async () => {
  const providerSub = fake.completeCheckout({ customerId, basePriceId: PRICE.growthYear, metadata: { userId, planId: growthId }, start: d("2026-09-05T00:00:00Z") });
  await syncSubscription(ctx, fake, providerSub);

  await markPaymentFailed(ctx, providerSub.id, NOW);
  let sub = await liveSub();
  assert.equal(sub.status, "PAST_DUE");
  assert.equal(sub.graceEndsAt?.toISOString(), "2026-09-20T12:00:00.000Z");
  await markPaymentFailed(ctx, providerSub.id, d("2026-09-10T12:00:00Z"));
  assert.equal((await liveSub()).graceEndsAt?.toISOString(), "2026-09-20T12:00:00.000Z", "retries do not extend grace");

  // The provider is still retrying: past due, and the prepaid year is untouched.
  await syncSubscription(ctx, fake, fake.setStatus(providerSub.id, "past_due"));
  sub = await liveSub();
  assert.equal(sub.status, "PAST_DUE");
  assert.equal(sub.basePeriodEnd?.toISOString(), "2027-09-05T00:00:00.000Z");

  await markPaymentSucceeded(ctx, providerSub.id);
  sub = await liveSub();
  assert.equal(sub.status, "ACTIVE");
  assert.equal(sub.graceEndsAt, null);
});

test("a past_due status seen through sync opens grace once; active clears it and a payment restriction", { skip }, async () => {
  const providerSub = fake.completeCheckout({ customerId, basePriceId: PRICE.growthYear, metadata: { userId, planId: growthId }, start: d("2026-09-05T00:00:00Z") });
  await syncSubscription(ctx, fake, providerSub);

  await syncSubscription(ctx, fake, fake.setStatus(providerSub.id, "past_due"));
  const first = (await liveSub()).graceEndsAt;
  assert.ok(first, "grace opened from status alone (no payment_failed event needed)");
  await syncSubscription(ctx, fake, fake.setStatus(providerSub.id, "past_due"));
  assert.equal((await liveSub()).graceEndsAt?.getTime(), first!.getTime(), "second sync does not extend grace");

  // Grace expired and the enforcement step restricted ingest.
  await prisma.subscription.update({ where: { id: (await liveSub()).id }, data: { restriction: "PAYMENT_FAILED", restrictedAt: NOW } });
  await prisma.website.updateMany({ where: { userId }, data: { isBlocked: true } });

  await syncSubscription(ctx, fake, fake.setStatus(providerSub.id, "active"));
  const sub = await liveSub();
  assert.equal(sub.status, "ACTIVE");
  assert.equal(sub.graceEndsAt, null);
  assert.equal(sub.restriction, "NONE");
  assert.equal(await prisma.website.count({ where: { userId, isBlocked: true } }), 0);
});

test("invoice lines are classified against the plan's prices; a mid-year base charge is flagged", { skip }, async () => {
  const providerSub = fake.completeCheckout({ customerId, basePriceId: PRICE.growthYear, metadata: { userId, planId: growthId }, start: d("2026-09-05T00:00:00Z") });
  await syncSubscription(ctx, fake, providerSub);
  const sub = await liveSub();

  // What an overage charge's transaction looks like: one non-catalog line the
  // provider marks as usage, priced in units of 1,000 events.
  const usageCharge: ProviderInvoice = {
    id: `txn_usage_${marker}`,
    customerId,
    providerSubscriptionId: providerSub.id,
    status: "completed",
    number: "TEST-0001",
    hostedUrl: null,
    pdfUrl: null,
    billingReason: "subscription_charge",
    currency: "usd",
    subtotalCents: 486,
    totalCents: 486,
    amountPaidCents: 486,
    createdAt: d("2026-10-05T00:00:00Z"),
    billedAt: d("2026-10-05T01:00:00Z"),
    paidAt: d("2026-10-05T01:01:00Z"),
    lines: [
      {
        kind: "usage",
        priceId: null,
        quantity: 243, // units: ceil(242,180 / 1,000)
        amountCents: 486, // 243 units x 2c
        periodStart: d("2026-09-05T00:00:00Z"),
        periodEnd: d("2026-10-05T00:00:00Z"),
        description: "Extra events, 2026-09-05 to 2026-10-04 (242,180 events)",
      },
    ],
  };
  const stored = await recordInvoice(ctx, usageCharge);
  assert.equal(stored.hasUsageLine, true);
  assert.equal(stored.hasBaseLine, false, "a usage charge never carries the annual base");
  assert.equal(stored.usageQuantity, null, "the provider states units, not raw events");
  assert.equal(stored.usageUnits, 243);
  assert.equal(stored.usagePeriodStart?.toISOString(), "2026-09-05T00:00:00.000Z");
  assert.equal(stored.subscriptionId, sub.id);

  // Same transaction again (webhook redelivery) upserts, no duplicate.
  await recordInvoice(ctx, usageCharge);
  assert.equal(await prisma.billingInvoice.count({ where: { providerInvoiceId: usageCharge.id } }), 1);

  const basePriceIds = [PRICE.growthMonth, PRICE.growthYear];
  const classified = classifyLines(
    [
      { ...usageCharge.lines[0] },
      { kind: "other", priceId: PRICE.growthYear, quantity: 1, amountCents: 19_000, periodStart: d("2026-10-05T00:00:00Z"), periodEnd: d("2027-10-05T00:00:00Z"), description: "base" },
    ],
    { basePriceIds },
  );
  assert.deepEqual(classified.map((l) => l.kind), ["usage", "base"]);

  // A base line whose period starts strictly inside the prepaid year = charged early.
  const basePeriod = { start: sub.basePeriodStart, end: sub.basePeriodEnd };
  assert.equal(baseChargedEarly(classified, { billingReason: "subscription_recurring", createdAt: d("2026-10-05T00:00:00Z") }, basePeriod), true);
  // The legitimate renewal at the anniversary is not, whether the local row has rolled yet or not.
  const renewal = classifyLines(
    [{ kind: "other", priceId: PRICE.growthYear, quantity: 1, amountCents: 19_000, periodStart: d("2027-09-05T00:00:00Z"), periodEnd: d("2028-09-05T00:00:00Z"), description: "base" }],
    { basePriceIds },
  );
  assert.equal(baseChargedEarly(renewal, { billingReason: "subscription_recurring", createdAt: d("2027-09-05T00:00:00Z") }, basePeriod), false);
  assert.equal(
    baseChargedEarly(renewal, { billingReason: "subscription_recurring", createdAt: d("2027-09-05T00:00:00Z") }, { start: d("2027-09-05T00:00:00Z"), end: d("2028-09-05T00:00:00Z") }),
    false,
  );
  // A charge that is not a renewal is never flagged, whatever its dates.
  assert.equal(baseChargedEarly(classified, { billingReason: "subscription_charge", createdAt: d("2026-10-05T00:00:00Z") }, basePeriod), false);
});

test("a subscription under a different provider customer re-points the user at that customer", { skip }, async () => {
  // The overlay attaches the subscription to the customer whose email was
  // typed in, which need not be the one we created at checkout. The portal
  // and invoice list must follow the subscription's customer, not our guess.
  const { customerId: other } = await fake.createCustomer({ email: `${marker}-other@example.test`, userId });
  assert.notEqual(other, customerId);
  const providerSub = fake.completeCheckout({
    customerId: other,
    basePriceId: PRICE.growthMonth,
    metadata: { userId, planId: growthId, billingCycle: "MONTHLY" },
    start: d("2026-09-05T00:00:00Z"),
  });
  await syncSubscription(ctx, fake, providerSub);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { providerCustomerId: true } });
  assert.equal(user.providerCustomerId, other, "the user now maps to the customer the money lives under");
  assert.equal((await liveSub()).providerSubscriptionId, providerSub.id);
});

test("a second live provider subscription retires the local row but is reported, never silently absorbed", { skip }, async () => {
  const first = fake.completeCheckout({ customerId, basePriceId: PRICE.growthMonth, metadata: { userId, planId: growthId }, start: d("2026-09-05T00:00:00Z") });
  await syncSubscription(ctx, fake, first);
  const second = fake.completeCheckout({ customerId, basePriceId: PRICE.businessMonth, metadata: { userId, planId: businessId }, start: d("2026-09-05T00:00:10Z") });

  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
  try {
    await syncSubscription(ctx, fake, second);
  } finally {
    console.error = original;
  }

  const rows = await prisma.subscription.findMany({ where: { userId, providerSubscriptionId: { not: null } }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(rows.map((r) => r.status), ["CANCELED", "ACTIVE"], "one live local row");
  assert.equal(fake.subscriptions.get(first.id)!.status, "active", "nothing was cancelled at the provider on our own");
  assert.ok(errors.some((e) => e.includes("ANOMALY") && e.includes(first.id)), "the double billing is reported");
});
