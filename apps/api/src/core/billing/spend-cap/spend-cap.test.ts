import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveSpendCap, usageWithCap } from "./spend-cap.service.js";

const growth = {
  monthlyPrice: 1_900,
  yearlyPrice: 19_000,
  overagePricePer1k: 2,
  spendCapDefaultCents: 3_800,
  spendCapMinCents: 1_900,
  spendCapMaxCents: null,
};
const free = { ...growth, monthlyPrice: 0, yearlyPrice: 0, overagePricePer1k: null, spendCapDefaultCents: null, spendCapMinCents: null };

const paidMonthly = { billingCycle: "MONTHLY" as const, providerSubscriptionId: "sub_1", spendCapCents: null, pendingSpendCapCents: null };
const paidYearly = { ...paidMonthly, billingCycle: "YEARLY" as const };
const trial = { ...paidMonthly, providerSubscriptionId: null };

test("cap applies only to provider-backed pay-as-you-go subscriptions", () => {
  assert.equal(resolveSpendCap(growth, paidMonthly).applies, true);
  assert.equal(resolveSpendCap(growth, trial).applies, false, "trial: same plan, no card, no cap");
  assert.equal(resolveSpendCap(free, paidMonthly).applies, false, "free plan never bills overage");
});

test("default and bounds come from the plan; a customer value overrides the default", () => {
  const d = resolveSpendCap(growth, paidMonthly);
  assert.equal(d.capCents, 3_800);
  assert.equal(d.minCents, 1_900);
  assert.equal(d.maxCents, null);
  assert.equal(d.isDefault, true);
  const c = resolveSpendCap(growth, { ...paidMonthly, spendCapCents: 5_000, pendingSpendCapCents: 2_500 });
  assert.equal(c.capCents, 5_000);
  assert.equal(c.isDefault, false);
  assert.equal(c.pendingCents, 2_500);
});

test("annual customers are measured against the monthly-equivalent base", () => {
  const m = resolveSpendCap(growth, paidMonthly);
  const y = resolveSpendCap(growth, paidYearly);
  assert.equal(m.monthlyBaseCents, 1_900);
  assert.equal(y.monthlyBaseCents, Math.round(19_000 / 12));
  // Same overage, same cap, so the same protection: the annual customer has
  // slightly more headroom because the yearly price per month is lower.
  const um = usageWithCap(growth, paidMonthly, { totalEvents: 1_450_000, includedEvents: 500_000 });
  const uy = usageWithCap(growth, paidYearly, { totalEvents: 1_450_000, includedEvents: 500_000 });
  assert.equal(um.overageCents, 1_900);
  assert.equal(um.capReached, true, "1900 + 1900 = 3800 = cap");
  assert.equal(uy.overageCents, 1_900);
  assert.equal(uy.capReached, false, "1583 + 1900 < 3800");
  assert.equal(uy.capRemainingCents, 3_800 - 1_583 - 1_900);
});

test("trial and free periods compute usage with no overage cost and no cap", () => {
  const t = usageWithCap(growth, trial, { totalEvents: 600_000, includedEvents: 500_000 });
  assert.equal(t.overageEvents, 100_000);
  assert.equal(t.overageCents, 0);
  assert.equal(t.spendCapCents, null);
  assert.equal(t.capReached, false);
});
