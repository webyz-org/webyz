/**
 * Ledger integration tests against real Postgres with a scripted ClickHouse.
 *
 * Run with RUN_DB_TESTS=1 (uses DATABASE_URL from .env). Skipped otherwise so
 * the unit suite stays hermetic. Every row created here carries a unique
 * marker and is deleted in the teardown, so the dev database is left as found.
 */
import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ClickHouseClient } from "@clickhouse/client";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../generated/prisma/client.js";
import { PLAN_CATALOG, planRowFromCatalog } from "../catalog/index.js";
import {
  aggregatePeriod,
  closeOpenPeriods,
  closeStrandedPeriods,
  ensureOpenPeriod,
  verifyPeriodAgainstBuckets,
} from "./aggregation.service.js";
import type { HourRow } from "./usage-math.js";

const RUN = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const skip = RUN ? false : "set RUN_DB_TESTS=1 with DATABASE_URL to run";

const H = 3_600_000;
const iso = (s: string) => new Date(s);

/** A ClickHouse stand-in that returns whatever hour rows the test scripted. */
const scriptedClickhouse = (rows: () => HourRow[]) =>
  ({
    query: async () => ({
      json: async () =>
        rows().map((r) => ({
          hour: r.hour.toISOString().slice(0, 19).replace("T", " "),
          total: String(r.count),
        })),
    }),
  }) as unknown as ClickHouseClient;

let prisma: PrismaClient;
let userId: string;
let planId: string;
let subId: string;
let websiteId: string;
const marker = `ledger-test-${randomUUID()}`;

before(async () => {
  if (!RUN) return;
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

  const growth = PLAN_CATALOG.find((p) => p.code === "growth")!;
  const plan = await prisma.plan.upsert({
    where: { code: growth.code },
    update: {},
    create: planRowFromCatalog(growth, 2),
  });
  planId = plan.id;

  const user = await prisma.user.create({
    data: { name: marker, email: `${marker}@example.test`, provider: "email" },
  });
  userId = user.id;

  const site = await prisma.website.create({
    data: { name: marker, domain: `${marker}.example.test`, userId },
  });
  websiteId = site.id;

  const sub = await prisma.subscription.create({
    data: {
      userId,
      planId,
      status: "ACTIVE",
      billingCycle: "MONTHLY",
      currentPeriodStart: iso("2026-09-05T10:00:00Z"),
      currentPeriodEnd: iso("2026-10-05T10:00:00Z"),
    },
  });
  subId = sub.id;
});

after(async () => {
  if (!RUN) return;
  // Cascades remove subscriptions, periods, buckets and websites.
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect();
});

const loadSub = async () => {
  const sub = await prisma.subscription.findUniqueOrThrow({
    where: { id: subId },
    select: {
      id: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      plan: { select: { entitlements: true } },
      user: { select: { websites: { select: { id: true } } } },
    },
  });
  return { ...sub, currentPeriodStart: sub.currentPeriodStart!, currentPeriodEnd: sub.currentPeriodEnd! };
};

test("ensureOpenPeriod creates the current period once and refreshes included events", { skip }, async () => {
  const sub = await loadSub();
  const deps = { prisma, clickhouse: scriptedClickhouse(() => []) };

  const a = await ensureOpenPeriod(deps, sub, iso("2026-09-06T12:00:00Z"));
  const b = await ensureOpenPeriod(deps, sub, iso("2026-09-06T13:00:00Z"));
  assert.equal(a.id, b.id);
  assert.equal(a.status, "OPEN");
  assert.equal(Number(a.includedEvents), 500_000);

  const count = await prisma.billingPeriodUsage.count({ where: { subscriptionId: subId } });
  assert.equal(count, 1);
});

test("aggregatePeriod writes closed hours as buckets, counts the live hour, and is idempotent", { skip }, async () => {
  const sub = await loadSub();
  const now = iso("2026-09-06T12:30:00Z");
  let rows: HourRow[] = [
    { hour: iso("2026-09-05T09:00:00Z"), count: 999 }, // before the period: ignored
    { hour: iso("2026-09-05T10:00:00Z"), count: 100 },
    { hour: iso("2026-09-06T11:00:00Z"), count: 50 },
    { hour: iso("2026-09-06T12:00:00Z"), count: 7 }, // live hour, not stored
  ];
  const deps = { prisma, clickhouse: scriptedClickhouse(() => rows) };
  const period = await ensureOpenPeriod(deps, sub, now);

  const first = await aggregatePeriod(deps, sub, period, now);
  assert.equal(first.totalEvents, 157);
  assert.equal(first.closedBuckets, 2);
  assert.equal(first.liveHourEvents, 7);
  assert.equal(first.overageEvents, 0);

  // Re-running with identical input changes nothing.
  const second = await aggregatePeriod(deps, sub, period, now);
  assert.equal(second.totalEvents, 157);
  const buckets = await prisma.usageBucket.findMany({ where: { billingPeriodUsageId: period.id }, orderBy: { bucketStart: "asc" } });
  assert.equal(buckets.length, 2);
  assert.deepEqual(buckets.map((b) => Number(b.quantity)), [100, 50]);

  // Late-arriving events for an already closed hour are corrected, not added.
  rows = rows.map((r) => (r.hour.getTime() === iso("2026-09-06T11:00:00Z").getTime() ? { ...r, count: 60 } : r));
  const third = await aggregatePeriod(deps, sub, period, now);
  assert.equal(third.totalEvents, 167);
  const stored = await prisma.billingPeriodUsage.findUniqueOrThrow({ where: { id: period.id } });
  assert.equal(Number(stored.totalEvents), 167);

  const check = await verifyPeriodAgainstBuckets({ prisma }, period.id);
  assert.equal(Number(check.bucketSum), 160);
  assert.equal(check.consistent, true);
});

test("once the live hour closes it becomes a bucket and the live count moves on", { skip }, async () => {
  const sub = await loadSub();
  const rows: HourRow[] = [
    { hour: iso("2026-09-05T10:00:00Z"), count: 100 },
    { hour: iso("2026-09-06T11:00:00Z"), count: 60 },
    { hour: iso("2026-09-06T12:00:00Z"), count: 7 },
    { hour: iso("2026-09-06T13:00:00Z"), count: 3 },
  ];
  const deps = { prisma, clickhouse: scriptedClickhouse(() => rows) };
  const period = await ensureOpenPeriod(deps, sub, iso("2026-09-06T13:05:00Z"));
  const r = await aggregatePeriod(deps, sub, period, iso("2026-09-06T13:05:00Z"));
  assert.equal(r.closedBuckets, 3);
  assert.equal(r.liveHourEvents, 3);
  assert.equal(r.totalEvents, 170);
});

test("overage is total minus included, floored at zero, and stored on the period", { skip }, async () => {
  const sub = await loadSub();
  const rows: HourRow[] = [{ hour: iso("2026-09-05T10:00:00Z"), count: 500_250 }];
  const deps = { prisma, clickhouse: scriptedClickhouse(() => rows) };
  const period = await ensureOpenPeriod(deps, sub, iso("2026-09-06T13:05:00Z"));
  const r = await aggregatePeriod(deps, sub, period, iso("2026-09-06T13:05:00Z"));
  assert.equal(r.overageEvents, 250);
  const stored = await prisma.billingPeriodUsage.findUniqueOrThrow({ where: { id: period.id } });
  assert.equal(Number(stored.overageEvents), 250);
});

test("period rollover closes the old period with a final aggregation and opens the new one", { skip }, async () => {
  // Move the subscription to its next period, as a provider renewal or the
  // free-plan roll would.
  await prisma.subscription.update({
    where: { id: subId },
    data: { currentPeriodStart: iso("2026-10-05T10:00:00Z"), currentPeriodEnd: iso("2026-11-05T10:00:00Z") },
  });
  const sub = await loadSub();
  const now = iso("2026-10-05T10:20:00Z");

  const rows: HourRow[] = [
    { hour: iso("2026-10-05T09:00:00Z"), count: 11 }, // last hour of the old period
    { hour: iso("2026-10-05T10:00:00Z"), count: 5 }, // first (live) hour of the new one
  ];
  const deps = { prisma, clickhouse: scriptedClickhouse(() => rows) };

  const open = await ensureOpenPeriod(deps, sub, now);
  assert.equal(open.periodStart.getTime(), iso("2026-10-05T10:00:00Z").getTime());

  const periods = await prisma.billingPeriodUsage.findMany({
    where: { subscriptionId: subId },
    orderBy: { periodStart: "asc" },
  });
  assert.equal(periods.length, 2);
  assert.equal(periods[0].status, "CLOSED");
  assert.ok(periods[0].closedAt);
  assert.equal(periods[1].status, "OPEN");

  // The closed period's final aggregation saw only its own hours: the scripted
  // 10:00 row is on the boundary and belongs to the new period.
  const closedCheck = await verifyPeriodAgainstBuckets({ prisma }, periods[0].id);
  assert.equal(closedCheck.consistent, true);
  assert.equal(Number(closedCheck.storedTotal), Number(closedCheck.bucketSum));

  const fresh = await aggregatePeriod(deps, sub, open, now);
  assert.equal(fresh.totalEvents, 5);
  assert.equal(fresh.closedBuckets, 0);

  // Re-running ensureOpenPeriod is a no-op now.
  const again = await ensureOpenPeriod(deps, sub, now);
  assert.equal(again.id, open.id);
  assert.equal(await prisma.billingPeriodUsage.count({ where: { subscriptionId: subId } }), 2);
});

/**
 * A subscription of its own, so period dates can be moved without disturbing
 * the shared one. It shares the user's website, which is all the ledger needs
 * to reach the (scripted) ClickHouse query.
 */
const freshSub = async (periodStart: Date, periodEnd: Date) => {
  const sub = await prisma.subscription.create({
    data: {
      userId,
      planId,
      status: "ACTIVE",
      billingCycle: "MONTHLY",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    },
  });
  return { id: sub.id };
};

const loadSubById = async (id: string) => {
  const sub = await prisma.subscription.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      plan: { select: { entitlements: true } },
      user: { select: { websites: { select: { id: true } } } },
    },
  });
  return { ...sub, currentPeriodStart: sub.currentPeriodStart!, currentPeriodEnd: sub.currentPeriodEnd! };
};

test("a period starting mid-hour keeps that hour as a bucket", { skip }, async () => {
  // Periods are anchored to the moment the subscription started, so almost
  // none of them begin on the hour. Judging the first bucket by its start
  // instead of its overlap silently dropped everything from period_start to
  // the end of that hour, up to an hour of billable traffic per period.
  const { id } = await freshSub(iso("2026-09-10T07:18:14.287Z"), iso("2026-10-10T07:18:14.287Z"));
  const sub = await loadSubById(id);
  const rows: HourRow[] = [
    { hour: iso("2026-09-10T06:00:00Z"), count: 999 }, // ends at 07:00, before the period
    { hour: iso("2026-09-10T07:00:00Z"), count: 3_900 }, // the partial first hour
    { hour: iso("2026-09-10T08:00:00Z"), count: 40 },
  ];
  const deps = { prisma, clickhouse: scriptedClickhouse(() => rows) };
  const now = iso("2026-09-10T09:30:00Z");

  const period = await ensureOpenPeriod(deps, sub, now);
  const r = await aggregatePeriod(deps, sub, period, now);

  assert.equal(r.totalEvents, 3_940);
  assert.equal(r.closedBuckets, 2);
  const buckets = await prisma.usageBucket.findMany({
    where: { billingPeriodUsageId: period.id },
    orderBy: { bucketStart: "asc" },
  });
  assert.deepEqual(buckets.map((b) => Number(b.quantity)), [3_900, 40]);
  assert.equal(buckets[0].bucketStart.toISOString(), "2026-09-10T07:00:00.000Z");
});

test("adjacent periods each keep their own half of the boundary hour", { skip }, async () => {
  // Rollover at 07:18:14 splits that clock hour between two periods. Both
  // store a bucket at 07:00, which is only possible because a bucket is
  // unique per period; keyed per subscription, the second write hijacked the
  // first period's row and corrupted its closed total.
  const boundary = iso("2026-10-10T07:18:14.287Z");
  const { id } = await freshSub(iso("2026-09-10T07:18:14.287Z"), boundary);
  let rows: HourRow[] = [{ hour: iso("2026-10-10T07:00:00Z"), count: 11 }];
  const deps = { prisma, clickhouse: scriptedClickhouse(() => rows) };
  const now = iso("2026-10-10T09:30:00Z");

  await ensureOpenPeriod(deps, await loadSubById(id), iso("2026-09-10T09:00:00Z"));

  // The provider renewal moves the subscription on; the next sync rolls the ledger.
  await prisma.subscription.update({
    where: { id },
    data: { currentPeriodStart: boundary, currentPeriodEnd: iso("2026-11-10T07:18:14.287Z") },
  });
  const rolled = await loadSubById(id);
  const opened = await ensureOpenPeriod(deps, rolled, now); // closes the old period first

  rows = [{ hour: iso("2026-10-10T07:00:00Z"), count: 22 }];
  await aggregatePeriod(deps, rolled, opened, now);

  const periods = await prisma.billingPeriodUsage.findMany({
    where: { subscriptionId: id },
    orderBy: { periodStart: "asc" },
  });
  assert.equal(periods.length, 2);
  assert.equal(periods[0].status, "CLOSED");
  assert.equal(periods[1].status, "OPEN");

  const boundaryBuckets = await prisma.usageBucket.findMany({
    where: { subscriptionId: id, bucketStart: iso("2026-10-10T07:00:00Z") },
    orderBy: { quantity: "asc" },
  });
  assert.equal(boundaryBuckets.length, 2, "each period owns its half of the boundary hour");
  assert.deepEqual(boundaryBuckets.map((b) => b.billingPeriodUsageId).sort(), [periods[0].id, periods[1].id].sort());
  assert.deepEqual(boundaryBuckets.map((b) => Number(b.quantity)), [11, 22]);

  // The closed period's total still matches its own buckets exactly.
  const check = await verifyPeriodAgainstBuckets({ prisma }, periods[0].id);
  assert.equal(check.consistent, true);
  assert.equal(Number(check.storedTotal), 11);
});

test("closeOpenPeriods settles a retired subscription's period and is idempotent", { skip }, async () => {
  // A cancelled subscription is never visited by the usage sync again, so an
  // OPEN period left on it is frozen and invisible to overage charging, which
  // only considers CLOSED periods.
  const { id } = await freshSub(iso("2026-09-10T07:18:14.287Z"), iso("2026-10-10T07:18:14.287Z"));
  const sub = await loadSubById(id);
  const rows: HourRow[] = [
    { hour: iso("2026-09-10T07:00:00Z"), count: 100 },
    { hour: iso("2026-09-10T08:00:00Z"), count: 25 },
  ];
  const deps = { prisma, clickhouse: scriptedClickhouse(() => rows) };
  const now = iso("2026-09-10T09:30:00Z");
  const period = await ensureOpenPeriod(deps, sub, now);
  await aggregatePeriod(deps, sub, period, now);

  // Events arrive after the last hourly sync, then the subscription is retired.
  rows.push({ hour: iso("2026-09-11T10:00:00Z"), count: 7 });
  const closedAt = iso("2026-09-11T11:00:00Z");
  const first = await closeOpenPeriods(deps, id, closedAt);
  assert.deepEqual(first.closed, [period.id]);

  const stored = await prisma.billingPeriodUsage.findUniqueOrThrow({ where: { id: period.id } });
  assert.equal(stored.status, "CLOSED");
  assert.equal(stored.closedAt?.toISOString(), closedAt.toISOString());
  // The final aggregation picked up the events the last sync had not seen.
  assert.equal(Number(stored.totalEvents), 132);
  const check = await verifyPeriodAgainstBuckets({ prisma }, period.id);
  assert.equal(check.consistent, true);

  // Running again finds nothing to close and leaves the total alone.
  const second = await closeOpenPeriods(deps, id, iso("2026-09-12T00:00:00Z"));
  assert.deepEqual(second.closed, []);
  const after = await prisma.billingPeriodUsage.findUniqueOrThrow({ where: { id: period.id } });
  assert.equal(Number(after.totalEvents), 132);
  assert.equal(after.closedAt?.toISOString(), closedAt.toISOString());
});

test("closing mid-hour writes the partial hour as a bucket, so a CLOSED period's total matches it", { skip }, async () => {
  // A real cancellation lands mid-hour, inside a period whose end is still in
  // the future. The hour containing `now` is the live hour: counted into
  // totalEvents but not written as a bucket, which would leave every closed
  // period violating the invariant a CLOSED period is supposed to hold
  // (verifyPeriodAgainstBuckets: exact match). Closing has to flush it.
  const { id } = await freshSub(iso("2026-09-10T07:18:14.287Z"), iso("2026-10-10T07:18:14.287Z"));
  const sub = await loadSubById(id);
  const rows: HourRow[] = [
    { hour: iso("2026-09-11T08:00:00Z"), count: 100 }, // a closed hour
    { hour: iso("2026-09-11T09:00:00Z"), count: 55 }, // the hour the cancellation lands in
  ];
  const deps = { prisma, clickhouse: scriptedClickhouse(() => rows) };
  const period = await ensureOpenPeriod(deps, sub, iso("2026-09-11T09:30:00Z"));

  const { closed } = await closeOpenPeriods(deps, id, iso("2026-09-11T09:30:00Z"));
  assert.deepEqual(closed, [period.id]);

  const stored = await prisma.billingPeriodUsage.findUniqueOrThrow({ where: { id: period.id } });
  assert.equal(stored.status, "CLOSED");
  assert.equal(Number(stored.totalEvents), 155);
  const check = await verifyPeriodAgainstBuckets({ prisma }, period.id);
  assert.equal(Number(check.bucketSum), 155, "the partial hour must be a bucket, not a live count");
  assert.equal(check.consistent, true);
  // The partial hour is stored under its own clock hour.
  const buckets = await prisma.usageBucket.findMany({
    where: { billingPeriodUsageId: period.id },
    orderBy: { bucketStart: "asc" },
  });
  assert.deepEqual(buckets.map((b) => Number(b.quantity)), [100, 55]);
  // Nothing after the close is pulled in: the window is clipped at `now`.
  assert.equal(buckets.at(-1)?.bucketStart.toISOString(), "2026-09-11T09:00:00.000Z");
});

test("closeOpenPeriods without a ClickHouse client closes at the last synced total", { skip }, async () => {
  // Free and trial rows have no charge path, so their callers need not hold a
  // ClickHouse client to retire one.
  const { id } = await freshSub(iso("2026-09-10T07:18:14.287Z"), iso("2026-10-10T07:18:14.287Z"));
  const sub = await loadSubById(id);
  const rows: HourRow[] = [{ hour: iso("2026-09-10T07:00:00Z"), count: 64 }];
  const deps = { prisma, clickhouse: scriptedClickhouse(() => rows) };
  const now = iso("2026-09-10T09:30:00Z");
  const period = await ensureOpenPeriod(deps, sub, now);
  await aggregatePeriod(deps, sub, period, now);

  rows.push({ hour: iso("2026-09-10T10:00:00Z"), count: 500 }); // never aggregated
  const { closed } = await closeOpenPeriods({ prisma }, id, iso("2026-09-11T00:00:00Z"));
  assert.deepEqual(closed, [period.id]);

  const stored = await prisma.billingPeriodUsage.findUniqueOrThrow({ where: { id: period.id } });
  assert.equal(stored.status, "CLOSED");
  assert.equal(Number(stored.totalEvents), 64);
});

test("the hourly sweep closes a period stranded OPEN on a retired subscription", { skip }, async () => {
  // Cancellation closes its own periods, but that happens after the
  // transaction that retires the row, so a crash in between would leave one
  // OPEN where the sync loop never looks again. The sweep is the net, and it
  // closes at the stored total: re-reading ClickHouse for a window retention
  // may have trimmed could only move the total down.
  const { id } = await freshSub(iso("2026-09-10T07:18:14.287Z"), iso("2026-10-10T07:18:14.287Z"));
  const sub = await loadSubById(id);
  const deps = { prisma, clickhouse: scriptedClickhouse(() => [{ hour: iso("2026-09-10T07:00:00Z"), count: 90 }]) };
  const period = await ensureOpenPeriod(deps, sub, iso("2026-09-10T09:30:00Z"));
  await aggregatePeriod(deps, sub, period, iso("2026-09-10T09:30:00Z"));

  // Retired without closing, as an interrupted cancellation would leave it.
  await prisma.subscription.update({ where: { id }, data: { status: "CANCELED", canceledAt: new Date() } });
  assert.equal((await prisma.billingPeriodUsage.findUniqueOrThrow({ where: { id: period.id } })).status, "OPEN");

  const closed = await closeStrandedPeriods({ prisma }, { subscriptionIds: [id] });
  assert.equal(closed, 1);
  const stored = await prisma.billingPeriodUsage.findUniqueOrThrow({ where: { id: period.id } });
  assert.equal(stored.status, "CLOSED");
  assert.equal(Number(stored.totalEvents), 90);

  // A live subscription's open period is never swept.
  const liveSub = await freshSub(iso("2026-09-10T07:18:14.287Z"), iso("2026-10-10T07:18:14.287Z"));
  const livePeriod = await ensureOpenPeriod(deps, await loadSubById(liveSub.id), iso("2026-09-10T09:30:00Z"));
  assert.equal(await closeStrandedPeriods({ prisma }, { subscriptionIds: [liveSub.id] }), 0);
  assert.equal((await prisma.billingPeriodUsage.findUniqueOrThrow({ where: { id: livePeriod.id } })).status, "OPEN");
});

test("a subscription with no websites records a zero period without querying", { skip }, async () => {
  await prisma.website.delete({ where: { id: websiteId } });
  const sub = await loadSub();
  let queried = false;
  const deps = {
    prisma,
    clickhouse: { query: async () => { queried = true; return { json: async () => [] }; } } as unknown as ClickHouseClient,
  };
  const now = iso("2026-10-06T10:20:00Z");
  const period = await ensureOpenPeriod(deps, sub, now);
  const r = await aggregatePeriod(deps, sub, period, now);
  assert.equal(queried, false);
  assert.equal(r.totalEvents, 0);
});
