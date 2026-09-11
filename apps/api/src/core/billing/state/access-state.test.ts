import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveAccess, type SubscriptionSnapshot } from "./access-state.js";

const NOW = new Date("2026-09-06T12:00:00Z");
const day = 86_400_000;

const base = (over: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot => ({
  status: "ACTIVE",
  restriction: "NONE",
  trialEndsAt: null,
  graceEndsAt: null,
  providerSubscriptionId: null,
  plan: { isFree: true },
  ...over,
});

test("no subscription row behaves as free so nothing is blocked by accident", () => {
  const a = deriveAccess(null, NOW);
  assert.equal(a.state, "FREE");
  assert.equal(a.ingestAllowed, true);
});

test("active on the free plan is FREE, active with a provider subscription is PAID", () => {
  assert.equal(deriveAccess(base(), NOW).state, "FREE");
  assert.equal(
    deriveAccess(base({ plan: { isFree: false }, providerSubscriptionId: "sub_1" }), NOW).state,
    "PAID",
  );
});

test("a local trial is TRIAL until its end date and exposes the end date", () => {
  const trialEndsAt = new Date(NOW.getTime() + 10 * day);
  const a = deriveAccess(
    base({ status: "TRIALING", trialEndsAt, plan: { isFree: false } }),
    NOW,
  );
  assert.equal(a.state, "TRIAL");
  assert.equal(a.ingestAllowed, true);
  assert.equal(a.until, trialEndsAt);
});

test("a trial past its end date is not blocked before the expiry job runs", () => {
  const a = deriveAccess(
    base({ status: "TRIALING", trialEndsAt: new Date(NOW.getTime() - day), plan: { isFree: false } }),
    NOW,
  );
  assert.equal(a.state, "TRIAL");
  assert.equal(a.ingestAllowed, true);
});

test("past due is GRACE with ingest on and the grace deadline exposed", () => {
  const graceEndsAt = new Date(NOW.getTime() + 14 * day);
  const a = deriveAccess(
    base({ status: "PAST_DUE", graceEndsAt, providerSubscriptionId: "sub_1", plan: { isFree: false } }),
    NOW,
  );
  assert.equal(a.state, "GRACE");
  assert.equal(a.ingestAllowed, true);
  assert.equal(a.dashboardAllowed, true);
  assert.equal(a.reason, "PAYMENT_GRACE");
  assert.equal(a.until, graceEndsAt);
});

test("any restriction wins over status and turns ingest off, dashboards stay on", () => {
  for (const restriction of ["FREE_QUOTA", "SPEND_CAP", "PAYMENT_FAILED", "TRIAL_ENDED"] as const) {
    const a = deriveAccess(base({ restriction, status: "ACTIVE" }), NOW);
    assert.equal(a.state, "RESTRICTED");
    assert.equal(a.ingestAllowed, false);
    assert.equal(a.dashboardAllowed, true);
    assert.equal(a.reason, restriction);
  }
});

test("terminal statuses are ENDED", () => {
  for (const status of ["CANCELED", "INCOMPLETE"] as const) {
    assert.equal(deriveAccess(base({ status }), NOW).state, "ENDED");
  }
});

test("UNPAID restricts ingest for non-payment but does not end the subscription", () => {
  const a = deriveAccess(base({ status: "UNPAID", providerSubscriptionId: "sub_1", plan: { isFree: false } }), NOW);
  assert.equal(a.state, "RESTRICTED");
  assert.equal(a.ingestAllowed, false);
  assert.equal(a.dashboardAllowed, true);
  assert.equal(a.reason, "PAYMENT_FAILED");
});
