import { test } from "node:test";
import assert from "node:assert/strict";

import { alreadyReported, completedReportPeriod, localDateString } from "./report-periods.js";

const utc = (iso: string) => new Date(iso);
const seconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

test("weekly: a Wednesday in UTC covers the previous Monday to Sunday and is due", () => {
  // Wed 9 Sep 2026 12:00 UTC. Previous week: Mon 31 Aug .. Sun 6 Sep.
  const p = completedReportPeriod("WEEKLY", utc("2026-09-09T12:00:00Z"), "UTC");
  assert.equal(p.from, seconds("2026-08-31T00:00:00Z"));
  assert.equal(p.to, seconds("2026-09-07T00:00:00Z"));
  assert.equal(p.compareFrom, seconds("2026-08-24T00:00:00Z"));
  assert.equal(p.compareTo, p.from);
  assert.equal(p.sendAt, utc("2026-09-07T09:00:00Z").getTime());
  assert.equal(p.due, true);
  assert.equal(p.label, "31 Aug to 6 Sep 2026");
});

test("weekly: Monday before the send hour is not yet due, but covers the week that just ended", () => {
  // Mon 7 Sep 2026 08:59 UTC.
  const p = completedReportPeriod("WEEKLY", utc("2026-09-07T08:59:00Z"), "UTC");
  assert.equal(p.to, seconds("2026-09-07T00:00:00Z"));
  assert.equal(p.due, false);
  const later = completedReportPeriod("WEEKLY", utc("2026-09-07T09:00:00Z"), "UTC");
  assert.equal(later.due, true);
});

test("weekly: Monday itself is the week boundary, Sunday still belongs to the running week", () => {
  // Sun 6 Sep 2026 23:00 UTC: the last complete week is 24 .. 30 Aug.
  const p = completedReportPeriod("WEEKLY", utc("2026-09-06T23:00:00Z"), "UTC");
  assert.equal(p.from, seconds("2026-08-24T00:00:00Z"));
  assert.equal(p.to, seconds("2026-08-31T00:00:00Z"));
  assert.equal(p.label, "24 to 30 Aug 2026");
});

test("weekly: boundaries and send hour follow the site's timezone", () => {
  // 2026-09-07T03:30Z is Monday 09:00 in Asia/Kolkata (+05:30): due there, not in UTC.
  const kolkata = completedReportPeriod("WEEKLY", utc("2026-09-07T03:30:00Z"), "Asia/Kolkata");
  assert.equal(kolkata.due, true);
  assert.equal(kolkata.from, seconds("2026-08-30T18:30:00Z"));
  assert.equal(kolkata.to, seconds("2026-09-06T18:30:00Z"));

  const utcView = completedReportPeriod("WEEKLY", utc("2026-09-07T03:30:00Z"), "UTC");
  assert.equal(utcView.due, false);

  // In Los Angeles (-07:00) it is still Sunday evening, so the last complete
  // week is one earlier.
  const la = completedReportPeriod("WEEKLY", utc("2026-09-07T03:30:00Z"), "America/Los_Angeles");
  assert.equal(la.to, seconds("2026-08-31T07:00:00Z"));
});

test("monthly: covers the previous calendar month, due on the 1st at 09:00 local", () => {
  const p = completedReportPeriod("MONTHLY", utc("2026-09-01T08:00:00Z"), "UTC");
  assert.equal(p.from, seconds("2026-08-01T00:00:00Z"));
  assert.equal(p.to, seconds("2026-09-01T00:00:00Z"));
  assert.equal(p.due, false);
  assert.equal(p.label, "August 2026");
  assert.equal(completedReportPeriod("MONTHLY", utc("2026-09-01T09:00:00Z"), "UTC").due, true);
  assert.equal(completedReportPeriod("MONTHLY", utc("2026-09-20T09:00:00Z"), "UTC").due, true);
});

test("monthly: January reports December of the previous year", () => {
  const p = completedReportPeriod("MONTHLY", utc("2027-01-15T12:00:00Z"), "UTC");
  assert.equal(p.from, seconds("2026-12-01T00:00:00Z"));
  assert.equal(p.to, seconds("2027-01-01T00:00:00Z"));
  assert.equal(p.compareFrom, p.from - (p.to - p.from));
  assert.equal(p.label, "December 2026");
});

test("monthly: DST change inside the month is absorbed by the local boundaries", () => {
  // Europe/Berlin leaves DST on 25 Oct 2026. Both boundaries are local midnight.
  const p = completedReportPeriod("MONTHLY", utc("2026-11-02T12:00:00Z"), "Europe/Berlin");
  assert.equal(p.from, seconds("2026-09-30T22:00:00Z")); // 1 Oct 00:00 +02:00
  assert.equal(p.to, seconds("2026-10-31T23:00:00Z")); // 1 Nov 00:00 +01:00
  assert.equal(p.sendAt, utc("2026-11-01T08:00:00Z").getTime()); // 09:00 +01:00
});

test("alreadyReported: a stored end at or past the period end means skip", () => {
  const to = seconds("2026-09-07T00:00:00Z");
  assert.equal(alreadyReported(null, to), false);
  assert.equal(alreadyReported(utc("2026-08-31T00:00:00Z"), to), false);
  assert.equal(alreadyReported(utc("2026-09-07T00:00:00Z"), to), true);
  assert.equal(alreadyReported(utc("2026-09-14T00:00:00Z"), to), true);
});

test("localDateString: the local calendar date, not the UTC one", () => {
  // 2026-08-30T18:30Z is 31 Aug 00:00 in Asia/Kolkata.
  assert.equal(localDateString(seconds("2026-08-30T18:30:00Z"), "Asia/Kolkata"), "2026-08-31");
  assert.equal(localDateString(seconds("2026-08-30T18:30:00Z"), "UTC"), "2026-08-30");
  // Last second of a period in Los Angeles is still the previous local day.
  assert.equal(localDateString(seconds("2026-08-31T06:59:59Z"), "America/Los_Angeles"), "2026-08-30");
});
