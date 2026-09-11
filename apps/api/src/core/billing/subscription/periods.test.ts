import { test } from "node:test";
import assert from "node:assert/strict";

import type { ProviderSubscriptionItem } from "../provider/billing-provider.js";
import { addMonths, baseItemOf, deriveBasePeriod, deriveBillingCycle, deriveUsagePeriod } from "./periods.js";

const d = (s: string) => new Date(s);

const item = (interval: "month" | "year", recurring = true): ProviderSubscriptionItem => ({
  priceId: `price_${interval}`,
  quantity: 1,
  interval,
  intervalCount: 1,
  recurring,
});

test("the base period is the provider billing period", () => {
  assert.deepEqual(deriveBasePeriod({ periodStart: d("2026-09-05T00:00:00Z"), periodEnd: d("2027-09-05T00:00:00Z") }), {
    start: d("2026-09-05T00:00:00Z"),
    end: d("2027-09-05T00:00:00Z"),
  });
  assert.equal(deriveBasePeriod({ periodStart: null, periodEnd: null }), null);
});

test("the billing cycle comes from the recurring item, ignoring one-off charges", () => {
  assert.equal(deriveBillingCycle([item("year"), item("month", false)]), "YEARLY");
  assert.equal(deriveBillingCycle([item("month")]), "MONTHLY");
  // No recurring item at all: treat as monthly rather than throwing, so a
  // half-built subscription still syncs.
  assert.equal(deriveBillingCycle([]), "MONTHLY");
  assert.equal(baseItemOf([item("month", false)]), null);
});

test("a monthly plan's usage period is its billing period", () => {
  const base = { start: d("2026-09-05T00:00:00Z"), end: d("2026-10-05T00:00:00Z") };
  assert.deepEqual(deriveUsagePeriod(base, "MONTHLY", d("2026-09-20T00:00:00Z")), base);
});

test("an annual plan gets monthly usage windows anchored to the base start", () => {
  const base = { start: d("2026-09-05T00:00:00Z"), end: d("2027-09-05T00:00:00Z") };

  // First month of the year.
  assert.deepEqual(deriveUsagePeriod(base, "YEARLY", d("2026-09-20T00:00:00Z")), {
    start: d("2026-09-05T00:00:00Z"),
    end: d("2026-10-05T00:00:00Z"),
  });
  // Third month.
  assert.deepEqual(deriveUsagePeriod(base, "YEARLY", d("2026-11-06T00:00:00Z")), {
    start: d("2026-11-05T00:00:00Z"),
    end: d("2026-12-05T00:00:00Z"),
  });
  // Exactly on a boundary belongs to the window that starts there.
  assert.deepEqual(deriveUsagePeriod(base, "YEARLY", d("2026-10-05T00:00:00Z")), {
    start: d("2026-10-05T00:00:00Z"),
    end: d("2026-11-05T00:00:00Z"),
  });
  // The last window is clipped to the prepaid year.
  assert.deepEqual(deriveUsagePeriod(base, "YEARLY", d("2027-08-30T00:00:00Z")), {
    start: d("2027-08-05T00:00:00Z"),
    end: d("2027-09-05T00:00:00Z"),
  });
  // Before the period started: the first window, never one in the past.
  assert.deepEqual(deriveUsagePeriod(base, "YEARLY", d("2026-09-01T00:00:00Z")), {
    start: d("2026-09-05T00:00:00Z"),
    end: d("2026-10-05T00:00:00Z"),
  });
  assert.equal(deriveUsagePeriod(null, "YEARLY", d("2026-09-20T00:00:00Z")), null);
});

test("a month is added by calendar, clamped to the end of a short month", () => {
  assert.deepEqual(addMonths(d("2026-01-31T10:00:00Z")), d("2026-02-28T10:00:00Z"));
  assert.deepEqual(addMonths(d("2026-08-31T00:00:00Z")), d("2026-09-30T00:00:00Z"));
  assert.deepEqual(addMonths(d("2026-12-15T00:00:00Z")), d("2027-01-15T00:00:00Z"));
  assert.deepEqual(addMonths(d("2028-01-31T00:00:00Z")), d("2028-02-29T00:00:00Z"), "leap year");
});

test("an annual window anchored to the 31st stays on the last day of short months", () => {
  const base = { start: d("2026-01-31T00:00:00Z"), end: d("2027-01-31T00:00:00Z") };
  assert.deepEqual(deriveUsagePeriod(base, "YEARLY", d("2026-03-01T00:00:00Z")), {
    start: d("2026-02-28T00:00:00Z"),
    end: d("2026-03-31T00:00:00Z"),
  });
});
