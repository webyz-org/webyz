/**
 * Retention as a query bound, pure. The four plan values from the catalog are
 * exercised against a fixed clock so the floor is checked to the second.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { clampToFloor, resolvePeriod, retentionFloor } from "../../../http/normalize/period.js";
import { PLAN_CATALOG } from "../catalog/index.js";

const NOW = Date.parse("2026-09-06T15:30:00Z");
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

test("the floor is local midnight `retention_days` days before today, in the site's timezone", () => {
  assert.equal(retentionFloor({ retentionDays: 90, timezone: "UTC", now: NOW }), sec("2026-06-08T00:00:00Z"));
  // Kolkata is UTC+5:30: local midnight 90 days back is 18:30Z the evening before.
  assert.equal(retentionFloor({ retentionDays: 90, timezone: "Asia/Kolkata", now: NOW }), sec("2026-06-07T18:30:00Z"));
  // New York: 2026-06-08 local midnight is 04:00Z (EDT).
  assert.equal(retentionFloor({ retentionDays: 90, timezone: "America/New_York", now: NOW }), sec("2026-06-08T04:00:00Z"));
});

test("catalog retention: Free 90, Starter 365, Growth 730, Business 1095 days", () => {
  const days = Object.fromEntries(PLAN_CATALOG.map((p) => [p.code, p.entitlements.retention_days]));
  assert.deepEqual(days, { free: 90, starter: 365, growth: 730, business: 1095 });
  assert.equal(retentionFloor({ retentionDays: days.starter, timezone: "UTC", now: NOW }), sec("2025-09-06T00:00:00Z"));
  assert.equal(retentionFloor({ retentionDays: days.growth, timezone: "UTC", now: NOW }), sec("2024-09-06T00:00:00Z"));
  assert.equal(retentionFloor({ retentionDays: days.business, timezone: "UTC", now: NOW }), sec("2023-09-07T00:00:00Z"));
});

test("a window inside retention is returned unchanged", () => {
  const floor = retentionFloor({ retentionDays: 90, timezone: "UTC", now: NOW });
  const range = { from: sec("2026-08-01T00:00:00Z"), to: sec("2026-09-01T00:00:00Z") };
  assert.deepEqual(clampToFloor(range, floor), { ...range, clamped: false, empty: false });
});

test("a window that starts before the floor is cut at the floor; `to` is untouched", () => {
  const floor = retentionFloor({ retentionDays: 90, timezone: "UTC", now: NOW });
  const range = { from: sec("2026-01-01T00:00:00Z"), to: sec("2026-09-01T00:00:00Z") };
  assert.deepEqual(clampToFloor(range, floor), { from: floor, to: range.to, clamped: true, empty: false });
});

test("a window entirely before the floor becomes the empty window at the floor", () => {
  const floor = retentionFloor({ retentionDays: 90, timezone: "UTC", now: NOW });
  const range = { from: sec("2025-01-01T00:00:00Z"), to: sec("2025-02-01T00:00:00Z") };
  assert.deepEqual(clampToFloor(range, floor), { from: floor, to: floor, clamped: true, empty: true });
  // Ending exactly at the floor is also empty: `to` is exclusive.
  assert.equal(clampToFloor({ from: 0, to: floor }, floor).empty, true);
});

test("a window starting exactly at the floor is not clamped", () => {
  const floor = retentionFloor({ retentionDays: 90, timezone: "UTC", now: NOW });
  assert.equal(clampToFloor({ from: floor, to: floor + 86_400 }, floor).clamped, false);
});

test("`all_time` and an ancient custom `from` both collapse to the floor: the client cannot reach past it", () => {
  const floor = retentionFloor({ retentionDays: 90, timezone: "UTC", now: NOW });
  const allTime = resolvePeriod({ period: "all_time", timezone: "UTC" });
  assert.equal(clampToFloor(allTime, floor).from, floor);
  const custom = resolvePeriod({ period: "custom", from: "1999-12-31", to: "2026-09-06", timezone: "UTC" });
  assert.equal(clampToFloor(custom, floor).from, floor);
  assert.equal(clampToFloor(custom, floor).clamped, true);
});

test("`last_91_days` on a 90 day plan is exactly the retained window; one day earlier is cut", () => {
  const floor = retentionFloor({ retentionDays: 90, timezone: "UTC", now: NOW });
  // Today plus the 90 days before it: its first day is the floor day itself.
  const range = resolvePeriod({ period: "last_91_days", date: "2026-09-06", timezone: "UTC" });
  assert.equal(range.from, floor);
  assert.equal(clampToFloor(range, floor).clamped, false);
  const oneDayMore = { from: range.from - 86_400, to: range.to };
  const clamped = clampToFloor(oneDayMore, floor);
  assert.equal(clamped.clamped, true);
  assert.equal(clamped.from - oneDayMore.from, 86_400);
});
