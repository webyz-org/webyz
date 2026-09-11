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
import { aggregatePeriod, ensureOpenPeriod, verifyPeriodAgainstBuckets } from "./aggregation.service.js";
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
