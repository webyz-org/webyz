import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BILLING_CONFIG,
  PLAN_CATALOG,
  annualPriceFor,
  getPlanDefinition,
  planRowFromCatalog,
  spendCapBoundsFor,
  validateCatalog,
} from "./index.js";
import { MINIMAL_ENTITLEMENTS, parseEntitlements } from "./entitlements.schema.js";

test("the shipped catalog satisfies every invariant", () => {
  assert.deepEqual(validateCatalog(), []);
});

test("every plan code is unique and the trial plan exists", () => {
  const codes = PLAN_CATALOG.map((p) => p.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(getPlanDefinition(BILLING_CONFIG.trial.planCode));
});

test("exactly one free plan, and it never bills overage", () => {
  const free = PLAN_CATALOG.filter((p) => p.monthlyPrice === 0);
  assert.equal(free.length, 1);
  assert.equal(free[0].overagePricePer1k, null);
  assert.deepEqual(spendCapBoundsFor(free[0]), {
    defaultCents: null,
    minCents: null,
    maxCents: null,
  });
});

test("paid plans get a spend cap at or above the minimum, derived from the price", () => {
  for (const def of PLAN_CATALOG.filter((p) => p.monthlyPrice > 0)) {
    const caps = spendCapBoundsFor(def);
    assert.equal(caps.defaultCents, def.monthlyPrice * BILLING_CONFIG.spendCap.defaultMultiplier);
    assert.equal(caps.minCents, def.monthlyPrice * BILLING_CONFIG.spendCap.minMultiplier);
    assert.ok(caps.defaultCents! >= caps.minCents!);
    assert.equal(caps.maxCents, null);
  }
});

test("annual price follows the catalog rule, not a hard-coded discount", () => {
  assert.equal(annualPriceFor(1_900), 1_900 * BILLING_CONFIG.annualMonthsCharged);
});

test("the seeded row mirrors entitlements into the legacy columns", () => {
  const growth = getPlanDefinition("growth");
  const row = planRowFromCatalog(growth, 2);
  assert.equal(row.eventLimit, growth.entitlements.events_per_period);
  assert.equal(row.websiteLimit, growth.entitlements.sites);
  assert.equal(row.dataRetentionDays, growth.entitlements.retention_days);
  assert.equal(row.extraPricePer100k, growth.overagePricePer1k! * 100);
  assert.equal(row.isFree, false);
  assert.equal(planRowFromCatalog(getPlanDefinition("free"), 0).isFree, true);
});

test("validateCatalog reports the problems a bad edit would introduce", () => {
  const broken = [
    ...PLAN_CATALOG,
    { ...getPlanDefinition("free"), code: "free" as const },
    { ...getPlanDefinition("starter"), code: "oops" as never, monthlyPrice: 0 },
  ];
  const problems = validateCatalog(broken);
  assert.ok(problems.some((p) => p.includes("duplicate plan code")));
  assert.ok(problems.some((p) => p.includes("is free but bills overage")));
  assert.ok(problems.some((p) => p.includes("exactly one free plan")));
});

test("invalid stored entitlements degrade to the minimal grant, never to everything", () => {
  assert.deepEqual(parseEntitlements(null), MINIMAL_ENTITLEMENTS);
  assert.deepEqual(parseEntitlements({}), MINIMAL_ENTITLEMENTS);
  assert.deepEqual(parseEntitlements({ sites: "ten" }), MINIMAL_ENTITLEMENTS);
  const growth = getPlanDefinition("growth").entitlements;
  assert.deepEqual(parseEntitlements(growth), growth);
});
