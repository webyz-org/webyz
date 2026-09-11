import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeUsage,
  eventsUntilCap,
  nextThresholdCrossed,
  projectPeriodTotal,
  splitHourRows,
  startOfHour,
  sumCounts,
} from "./usage-math.js";

const growth = { includedEvents: 500_000, overagePricePer1k: 2, basePriceCents: 1_900, spendCapCents: 3_800 };
const free = { includedEvents: 10_000, overagePricePer1k: null, basePriceCents: 0, spendCapCents: null };

test("below included usage: no overage, no extra cost, cap far away", () => {
  const u = computeUsage({ ...growth, totalEvents: 120_000 });
  assert.equal(u.overageEvents, 0);
  assert.equal(u.overageCents, 0);
  assert.equal(u.remainingIncluded, 380_000);
  assert.equal(u.currentBillCents, 1_900);
  assert.equal(u.capReached, false);
  assert.equal(u.capApproaching, false);
  assert.equal(u.capRemainingCents, 1_900);
});

test("exactly at included usage is not overage", () => {
  const u = computeUsage({ ...growth, totalEvents: 500_000 });
  assert.equal(u.overageEvents, 0);
  assert.equal(u.usageRatio, 1);
  assert.equal(u.overageUnits, 0);
});

test("one event over bills one full 1k unit (rounding up, never fractional)", () => {
  const u = computeUsage({ ...growth, totalEvents: 500_001 });
  assert.equal(u.overageEvents, 1);
  assert.equal(u.overageUnits, 1);
  assert.equal(u.overageCents, 2);
  assert.equal(u.currentBillCents, 1_902);
});

test("overage units round up at each 1k boundary", () => {
  assert.equal(computeUsage({ ...growth, totalEvents: 501_000 }).overageUnits, 1);
  assert.equal(computeUsage({ ...growth, totalEvents: 501_001 }).overageUnits, 2);
  assert.equal(computeUsage({ ...growth, totalEvents: 742_180 }).overageUnits, 243);
  assert.equal(computeUsage({ ...growth, totalEvents: 742_180 }).overageCents, 486);
});

test("free plan never bills: overage is counted but costs nothing and has no cap", () => {
  const u = computeUsage({ ...free, totalEvents: 25_000 });
  assert.equal(u.isPayAsYouGo, false);
  assert.equal(u.overageEvents, 15_000);
  assert.equal(u.overageUnits, 0);
  assert.equal(u.overageCents, 0);
  assert.equal(u.currentBillCents, 0);
  assert.equal(u.spendCapCents, null);
  assert.equal(u.capReached, false);
  assert.equal(eventsUntilCap(u, null), Infinity);
});

test("spend cap: approaching at 90%, reached at exactly the cap", () => {
  // Cap 3800, base 1900 -> 1900 cents of overage allowed = 950 units = 950k events.
  const approaching = computeUsage({ ...growth, totalEvents: 500_000 + 860_000 });
  assert.equal(approaching.currentBillCents, 1_900 + 1_720);
  assert.equal(approaching.capApproaching, true);
  assert.equal(approaching.capReached, false);

  const atCap = computeUsage({ ...growth, totalEvents: 500_000 + 950_000 });
  assert.equal(atCap.currentBillCents, 3_800);
  assert.equal(atCap.capReached, true);
  assert.equal(atCap.capApproaching, false);
  assert.equal(atCap.capRemainingCents, 0);
  assert.equal(eventsUntilCap(atCap, 2), 0);
});

test("cap remaining never goes negative when usage overshoots the cap", () => {
  const u = computeUsage({ ...growth, totalEvents: 5_000_000 });
  assert.equal(u.capRemainingCents, 0);
  assert.equal(u.capReached, true);
});

test("eventsUntilCap counts whole affordable units plus slack in the current unit", () => {
  const u = computeUsage({ ...growth, totalEvents: 500_500 }); // 1 unit used, 500 slack
  // remaining 1898 cents / 2 = 949 units + 500 slack
  assert.equal(eventsUntilCap(u, 2), 949_000 + 500);
});

test("a cap below the base price is reached immediately", () => {
  const u = computeUsage({ ...growth, totalEvents: 0, spendCapCents: 1_000 });
  assert.equal(u.capReached, true);
});

test("zero included events: any usage is infinite ratio, none is zero", () => {
  assert.equal(computeUsage({ ...growth, includedEvents: 0, totalEvents: 0 }).usageRatio, 0);
  assert.equal(computeUsage({ ...growth, includedEvents: 0, totalEvents: 5 }).usageRatio, Infinity);
});

test("thresholds: report the highest newly crossed, once", () => {
  const t = [0.8, 0.9, 1.0];
  assert.equal(nextThresholdCrossed(0.5, t, null), null);
  assert.equal(nextThresholdCrossed(0.85, t, null), 0.8);
  assert.equal(nextThresholdCrossed(0.85, t, 0.8), null);
  assert.equal(nextThresholdCrossed(1.4, t, null), 1.0);
  assert.equal(nextThresholdCrossed(1.4, t, 0.9), 1.0);
  assert.equal(nextThresholdCrossed(1.4, t, 1.0), null);
});

test("projection is linear in elapsed time and clamps at the edges", () => {
  const start = new Date("2026-09-05T00:00:00Z");
  const end = new Date("2026-10-05T00:00:00Z");
  const tenDaysIn = new Date("2026-09-15T00:00:00Z");
  assert.equal(projectPeriodTotal(100_000, start, end, tenDaysIn), 300_000);
  assert.equal(projectPeriodTotal(100_000, start, end, start), 100_000);
  assert.equal(projectPeriodTotal(100_000, start, end, end), 100_000);
  assert.equal(projectPeriodTotal(100_000, start, end, new Date("2026-11-01T00:00:00Z")), 100_000);
});

test("hour rows: period boundaries are [start, end), current hour is live, future is ignored", () => {
  const periodStart = new Date("2026-09-05T10:00:00Z");
  const periodEnd = new Date("2026-10-05T10:00:00Z");
  const now = new Date("2026-09-06T12:34:56Z");
  const rows = [
    { hour: new Date("2026-09-05T09:00:00Z"), count: 999 }, // before period
    { hour: new Date("2026-09-05T10:00:00Z"), count: 10 }, // first hour, inclusive
    { hour: new Date("2026-09-06T11:00:00Z"), count: 20 }, // closed
    { hour: new Date("2026-09-06T12:00:00Z"), count: 5 }, // live
    { hour: new Date("2026-09-06T13:00:00Z"), count: 7 }, // future
    { hour: new Date("2026-10-05T10:00:00Z"), count: 42 }, // period end, exclusive
  ];
  const { closed, live } = splitHourRows(rows, periodStart, periodEnd, now);
  assert.deepEqual(closed.map((r) => r.count), [10, 20]);
  assert.equal(live, 5);
  assert.equal(sumCounts(closed) + live, 35);
});

test("startOfHour floors to the UTC hour", () => {
  assert.equal(
    startOfHour(new Date("2026-09-06T12:34:56.789Z")).toISOString(),
    "2026-09-06T12:00:00.000Z",
  );
});
