/**
 * Overage charging against real Postgres with the fake provider.
 * Run with RUN_DB_TESTS=1. Rows carry a unique marker and are removed after.
 */
import "dotenv/config";
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../generated/prisma/client.js";
import { BILLING_CONFIG } from "../catalog/billing.config.js";
import { PLAN_CATALOG, planRowFromCatalog } from "../catalog/index.js";
import { FakeBillingProvider } from "../provider/fake.provider.js";
import { ProviderUnavailableError } from "../provider/billing-provider.js";
import {
  amountFor,
  chargeDescription,
  chargeOverageForClosedPeriods,
  idempotencyKeyFor,
  isBelowMinimumCharge,
  pendingDelta,
  unitsFor,
} from "./overage-charge.service.js";

const RUN = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const skip = RUN ? false : "set RUN_DB_TESTS=1 with DATABASE_URL to run";

const d = (s: string) => new Date(s);
const NOW = d("2026-10-05T01:00:00Z");
const UNIT = BILLING_CONFIG.usage.meterUnitEvents;
const RATE = PLAN_CATALOG.find((p) => p.code === "growth")!.overagePricePer1k!;

let prisma: PrismaClient;
let fake: FakeBillingProvider;
let userId: string;
let planId: string;
let customerId: string;
const marker = `charge-${randomUUID()}`;

before(async () => {
  if (!RUN) return;
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const growth = PLAN_CATALOG.find((p) => p.code === "growth")!;
  planId = (await prisma.plan.upsert({ where: { code: "growth" }, update: {}, create: planRowFromCatalog(growth, 2) })).id;
  customerId = `ctm_${marker}`;
  const user = await prisma.user.create({
    data: { name: marker, email: `${marker}@example.test`, provider: "email", providerCustomerId: customerId },
  });
  userId = user.id;
});

beforeEach(async () => {
  if (!RUN) return;
  fake = new FakeBillingProvider({ now: () => NOW });
  await prisma.subscription.deleteMany({ where: { userId } });
});

after(async () => {
  if (!RUN) return;
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect();
});

/**
 * A paid subscription with a usage period carrying the given counts, and the
 * matching subscription at the provider so a charge has something to ride on.
 */
const seed = async (opts: {
  cycle?: "MONTHLY" | "YEARLY";
  periodStart?: string;
  periodEnd?: string;
  total: number;
  included?: number;
  status?: "OPEN" | "CLOSED";
}) => {
  const periodStart = d(opts.periodStart ?? "2026-09-05T00:00:00Z");
  const periodEnd = d(opts.periodEnd ?? "2026-10-05T00:00:00Z");
  const included = opts.included ?? 500_000;
  const priceId = `pri_${randomUUID().slice(0, 8)}`;
  fake.registerPrice(priceId, opts.cycle === "YEARLY" ? "year" : "month");
  const providerSub = fake.completeCheckout({ customerId, basePriceId: priceId, start: periodStart });

  const sub = await prisma.subscription.create({
    data: {
      userId,
      planId,
      status: "ACTIVE",
      billingCycle: opts.cycle ?? "MONTHLY",
      providerSubscriptionId: providerSub.id,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      basePeriodStart: periodStart,
      basePeriodEnd: opts.cycle === "YEARLY" ? d("2027-09-05T00:00:00Z") : periodEnd,
    },
  });
  const period = await prisma.billingPeriodUsage.create({
    data: {
      subscriptionId: sub.id,
      periodStart,
      periodEnd,
      includedEvents: BigInt(included),
      totalEvents: BigInt(opts.total),
      overageEvents: BigInt(Math.max(0, opts.total - included)),
      status: opts.status ?? "CLOSED",
      closedAt: (opts.status ?? "CLOSED") === "CLOSED" ? periodEnd : null,
    },
  });
  return { sub, period, providerSub };
};

const reload = (id: string) =>
  prisma.billingPeriodUsage.findUniqueOrThrow({ where: { id }, include: { usageRecords: { orderBy: { createdAt: "asc" } } } });

/** The job, scoped to this test's subscriptions so the dev database's other rows are left alone. */
const run = async (now: Date) => {
  const subs = await prisma.subscription.findMany({ where: { userId }, select: { id: true } });
  return chargeOverageForClosedPeriods({ prisma }, fake, now, { subscriptionIds: subs.map((s) => s.id) });
};

/** Simulate a late aggregation moving the ledger without touching charging. */
const setUsage = async (periodId: string, total: number, included = 500_000) =>
  prisma.billingPeriodUsage.update({
    where: { id: periodId },
    data: { totalEvents: BigInt(total), overageEvents: BigInt(Math.max(0, total - included)) },
  });

test("pure helpers: delta never negative, key is period + cumulative, units round up", () => {
  assert.equal(pendingDelta({ overageEvents: BigInt(2_300), reportedEvents: BigInt(1_500) }), 800);
  assert.equal(pendingDelta({ overageEvents: BigInt(1_000), reportedEvents: BigInt(1_500) }), 0);
  assert.equal(idempotencyKeyFor("p1", BigInt(2_300)), "p1:2300");
  assert.equal(unitsFor(2_300), 3);
  assert.equal(unitsFor(1_000), 1);
  assert.equal(unitsFor(1), 1);
  // The description names the days billed, with the exclusive end excluded.
  assert.match(
    chargeDescription({ periodStart: d("2026-09-05T00:00:00Z"), periodEnd: d("2026-10-05T00:00:00Z") }, 2_300),
    /2026-09-05 to 2026-10-04 \(2,300 events\)/,
  );
});

test("an open period is never charged: it is still accruing", { skip }, async () => {
  const { period } = await seed({ total: 502_300, status: "OPEN" });
  const s = await run(NOW);
  assert.equal(s.periods, 0);
  assert.equal(fake.charges.size, 0);
  assert.equal(Number((await reload(period.id)).reportedEvents), 0);
});

test("pure: the provider minimum decides what is worth charging", () => {
  assert.equal(amountFor(2_300, 2), 6, "3 units at 2c");
  assert.equal(isBelowMinimumCharge(6), true);
  assert.equal(isBelowMinimumCharge(69), true);
  assert.equal(isBelowMinimumCharge(70), false);
  assert.equal(amountFor(35_000, 2), 70, "35,000 events is the first chargeable overage on Growth");
});

test("overage under the provider minimum is waived: settled, never billed, never retried", { skip }, async () => {
  const { period } = await seed({ total: 502_300 }); // 3 units at 2c = 6c
  const s = await run(NOW);
  assert.equal(s.waived, 1);
  assert.equal(s.sent, 0);
  assert.equal(fake.charges.size, 0, "nothing reached the provider");
  const p = await reload(period.id);
  assert.equal(Number(p.reportedEvents), 2_300, "the checkpoint is settled");
  assert.equal(p.usageRecords.length, 1);
  assert.equal(p.usageRecords[0].status, "WAIVED");
  assert.match(p.usageRecords[0].lastError ?? "", /6c is under the provider minimum of 70c/);
  assert.equal(p.usageRecords[0].providerTransactionId, null);

  // Next run: nothing pending, nothing retried.
  const again = await run(d("2026-10-05T02:00:00Z"));
  assert.equal(again.zero, 1);
  assert.equal((await reload(period.id)).usageRecords.length, 1);
});

test("a closed period within the allowance is not charged", { skip }, async () => {
  const { period } = await seed({ total: 120_000 });
  const s = await run(NOW);
  assert.equal(s.zero, 1);
  assert.equal(fake.charges.size, 0);
  assert.equal(Number((await reload(period.id)).reportedEvents), 0);
});

test("a closed period's overage is charged once, in units, at the plan's rate", { skip }, async () => {
  // 42,300 over is 43 units at 2c = 86c, clear of the 70c provider minimum.
  const { period, providerSub } = await seed({ total: 542_300 });
  let s = await run(NOW);
  assert.equal(s.sent, 1);

  let p = await reload(period.id);
  assert.equal(Number(p.reportedEvents), 42_300);
  assert.equal(p.usageRecords.length, 1);
  assert.equal(p.usageRecords[0].status, "SENT");
  assert.equal(Number(p.usageRecords[0].deltaEvents), 42_300);
  assert.equal(p.usageRecords[0].idempotencyKey, `${period.id}:42300`);
  assert.ok(p.usageRecords[0].providerTransactionId, "the charge transaction is recorded");

  const charge = [...fake.charges.values()][0];
  assert.equal(charge.providerSubscriptionId, providerSub.id);
  assert.equal(charge.units, 43, "42,300 events is 43 units of 1,000");
  assert.equal(charge.unitPriceCents, RATE);
  assert.match(charge.description, /Extra events/);

  // Same ledger, second run: nothing new.
  s = await run(NOW);
  assert.equal(s.zero, 1);
  assert.equal(fake.charges.size, 1);
});

test("provider failure: record FAILED, checkpoint and ledger untouched, retried with the same key", { skip }, async () => {
  const { period } = await seed({ total: 541_000 });
  fake.failNext.add("chargeOverage");

  const s1 = await run(NOW);
  assert.equal(s1.failed, 1);
  assert.equal(s1.errors[0].periodId, period.id);
  let p = await reload(period.id);
  assert.equal(Number(p.reportedEvents), 0, "checkpoint did not move");
  assert.equal(Number(p.overageEvents), 41_000, "ledger untouched");
  assert.equal(p.usageRecords[0].status, "FAILED");
  assert.equal(p.usageRecords[0].attempts, 1);
  assert.match(p.usageRecords[0].lastError ?? "", /unavailable/);
  assert.equal(fake.charges.size, 0);

  // Usage moved on before the retry. The old record is retried unchanged first.
  await setUsage(period.id, 541_600);
  const s2 = await run(d("2026-10-05T02:00:00Z"));
  assert.equal(s2.retried, 1);
  p = await reload(period.id);
  assert.equal(p.usageRecords[0].status, "SENT");
  assert.equal(p.usageRecords[0].attempts, 2);
  assert.equal(Number(p.reportedEvents), 41_000, "checkpoint is the retried record's cumulative, not the new overage");
  assert.equal([...fake.charges.keys()][0], `${period.id}:41000`);

  // Next run: the remaining 600 events are 2c, under the minimum, so waived.
  const s3 = await run(d("2026-10-05T03:00:00Z"));
  assert.equal(s3.waived, 1);
  assert.equal(Number((await reload(period.id)).reportedEvents), 41_600);
  const units = [...fake.charges.values()].reduce((a, c) => a + c.units, 0);
  assert.equal(units, unitsFor(41_000), "the waived tail was never sent");
});

test("a crash after charging does not bill twice: the provider deduplicates on the key", { skip }, async () => {
  const { period } = await seed({ total: 541_000 });
  await run(NOW);
  // Crash-after-send simulation: force the record back to PENDING and rerun.
  await prisma.usageRecord.updateMany({ where: { billingPeriodUsageId: period.id }, data: { status: "PENDING" } });
  await prisma.billingPeriodUsage.update({ where: { id: period.id }, data: { reportedEvents: BigInt(0) } });

  const s = await run(d("2026-10-05T02:00:00Z"));
  assert.equal(s.retried, 1);
  assert.equal(fake.calls.filter((c) => c.method === "chargeOverage").length, 2, "sent twice");
  assert.equal(fake.charges.size, 1, "charged once");
  assert.equal(Number((await reload(period.id)).reportedEvents), 41_000);
});

test("late downward correction is never charged as negative; the checkpoint stays", { skip }, async () => {
  const { period } = await seed({ total: 543_000 });
  await run(NOW);
  await setUsage(period.id, 542_000); // events purged after charging
  const s = await run(d("2026-10-05T02:00:00Z"));
  assert.equal(s.zero, 1);
  const p = await reload(period.id);
  assert.equal(Number(p.reportedEvents), 43_000);
  assert.equal(Number(p.overageEvents), 42_000, "ledger shows the truth; reconciliation sees the 1k gap");
});

test("late upward correction charges only the increment, once it is worth charging", { skip }, async () => {
  const { period } = await seed({ total: 543_000 });
  await run(NOW);
  // 250 more events is one unit, 2c: waived, not sent.
  await setUsage(period.id, 543_250);
  let s = await run(d("2026-10-05T02:00:00Z"));
  assert.equal(s.waived, 1);
  assert.equal(Number((await reload(period.id)).reportedEvents), 43_250);
  // A correction big enough to bill goes out as its own increment.
  await setUsage(period.id, 583_250);
  s = await run(d("2026-10-05T03:00:00Z"));
  assert.equal(s.sent, 1);
  const last = (await reload(period.id)).usageRecords.at(-1)!;
  assert.equal(Number(last.deltaEvents), 40_000);
  assert.equal([...fake.charges.values()].at(-1)!.units, 40);
});

test("annual: each monthly period is charged on its own, the prepaid year is untouched", { skip }, async () => {
  const { sub, period, providerSub } = await seed({ cycle: "YEARLY", total: 545_000 });
  await run(NOW);
  assert.equal(Number((await reload(period.id)).reportedEvents), 45_000);

  // The next monthly window on the same annual subscription, also closed.
  const oct = await prisma.billingPeriodUsage.create({
    data: {
      subscriptionId: sub.id,
      periodStart: d("2026-10-05T00:00:00Z"),
      periodEnd: d("2026-11-05T00:00:00Z"),
      includedEvents: BigInt(500_000),
      totalEvents: BigInt(540_800),
      overageEvents: BigInt(40_800),
      status: "CLOSED",
      closedAt: d("2026-11-05T00:00:00Z"),
    },
  });
  const s = await run(d("2026-11-05T01:00:00Z"));
  assert.equal(s.sent, 1);
  assert.equal(s.zero, 1, "September is already settled");
  assert.equal(Number((await reload(oct.id)).reportedEvents), 40_800);

  const charged = [...fake.charges.values()];
  assert.deepEqual(
    charged.map((c) => c.units),
    [unitsFor(45_000), unitsFor(40_800)],
  );
  assert.ok(charged.every((c) => c.providerSubscriptionId === providerSub.id));
  assert.equal(
    (await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).basePeriodEnd?.toISOString(),
    "2027-09-05T00:00:00.000Z",
    "the prepaid year is not touched by a usage charge",
  );
});

test("a period older than the provider window fails loudly and is not silently dropped", { skip }, async () => {
  const { period } = await seed({ periodStart: "2026-05-01T00:00:00Z", periodEnd: "2026-06-01T00:00:00Z", total: 541_000 });
  // Candidate selection looks back 60 days, so a June period is out of scope in October.
  const s = await run(NOW);
  assert.equal(s.periods, 0);
  // Near the boundary it is picked up, and refused with a clear error.
  const s2 = await run(d("2026-07-30T12:00:00Z"));
  assert.equal(s2.failed, 1);
  assert.match(s2.errors[0].error, /too old/);
  const p = await reload(period.id);
  assert.equal(p.usageRecords[0].status, "FAILED");
  assert.match(p.usageRecords[0].lastError ?? "", /Bill manually/);
  assert.equal(Number(p.reportedEvents), 0);
});

test("a plan that stopped billing overage is never charged for it", { skip }, async () => {
  const { period, sub } = await seed({ total: 542_000 });
  const free = await prisma.plan.findFirstOrThrow({ where: { isFree: true } });
  await prisma.subscription.update({ where: { id: sub.id }, data: { planId: free.id } });
  const s = await run(NOW);
  assert.equal(s.periods, 0, "a hard-limit plan is not a candidate");
  assert.equal(fake.charges.size, 0);
  assert.equal(Number((await reload(period.id)).reportedEvents), 0);
});

test("ProviderUnavailableError is what the fake throws, so retries are classified correctly", () => {
  const f = new FakeBillingProvider();
  f.alwaysFail.add("chargeOverage");
  return assert.rejects(
    f.chargeOverage({
      providerSubscriptionId: "sub_1",
      units: 1,
      unitPriceCents: 2,
      currency: "usd",
      description: "x",
      idempotencyKey: "k",
    }),
    ProviderUnavailableError,
  );
});

test("a FAILED record that is under the minimum settles as waived on retry instead of failing forever", { skip }, async () => {
  const { period } = await seed({ total: 501_000 }); // 1 unit, 2c
  // A record from before the minimum rule, or after a rate change: pending, tiny.
  await prisma.usageRecord.create({
    data: {
      subscriptionId: period.subscriptionId,
      billingPeriodUsageId: period.id,
      overageEvents: BigInt(1_000),
      deltaEvents: BigInt(1_000),
      cumulativeAfter: BigInt(1_000),
      idempotencyKey: `${period.id}:1000`,
      status: "FAILED",
      attempts: 3,
      lastError: "provider refused",
      provider: fake.name,
    },
  });
  const s = await run(NOW);
  assert.equal(s.retried, 1);
  assert.equal(fake.charges.size, 0, "never sent");
  const p = await reload(period.id);
  assert.equal(p.usageRecords[0].status, "WAIVED");
  assert.equal(p.usageRecords[0].attempts, 4);
  assert.equal(Number(p.reportedEvents), 1_000, "settled");
  assert.equal((await run(d("2026-10-05T02:00:00Z"))).zero, 1, "and it stays settled");
});
