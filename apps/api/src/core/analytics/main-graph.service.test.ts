import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bucketLabels, metricFromComponents } from "./main-graph.service.js";

const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;

describe("bucketLabels", () => {
  it("labels weeks by their Sunday, as ClickHouse toStartOfWeek buckets them", () => {
    // 1 Sep 2026 is a Tuesday; its week starts Sunday 30 Aug.
    assert.deepEqual(bucketLabels(utc("2026-09-01"), utc("2026-10-01"), "week", "UTC"), [
      "2026-08-30 00:00:00",
      "2026-09-06 00:00:00",
      "2026-09-13 00:00:00",
      "2026-09-20 00:00:00",
      "2026-09-27 00:00:00",
    ]);
  });

  it("labels months by their first day even when the window starts mid-month", () => {
    assert.deepEqual(bucketLabels(utc("2026-08-15"), utc("2026-10-01"), "month", "UTC"), [
      "2026-08-01 00:00:00",
      "2026-09-01 00:00:00",
    ]);
  });

  it("keeps daily labels on the window's own days, in the site's zone", () => {
    const from = Date.parse("2026-08-31T18:30:00Z") / 1000; // 1 Sep 00:00 in Kolkata
    assert.deepEqual(bucketLabels(from, from + 2 * 86_400, "day", "Asia/Kolkata"), [
      "2026-09-01 00:00:00",
      "2026-09-02 00:00:00",
    ]);
  });
});

describe("metricFromComponents", () => {
  const parts = { visitors: 10, visits: 20, pageviews: 50, bounces: 5, visit_duration: 600 };
  it("recomputes rates from summed parts", () => {
    assert.equal(metricFromComponents("visitors", parts), 10);
    assert.equal(metricFromComponents("views_per_visit", parts), 2.5);
    assert.equal(metricFromComponents("bounce_rate", parts), 25);
    assert.equal(metricFromComponents("visit_duration", parts), 30);
    assert.equal(metricFromComponents("bounce_rate", { ...parts, visits: 0 }), 0);
  });
});
