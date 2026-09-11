import { BILLING_CONFIG, type PlanCode } from "./billing.config.js";
import { PLAN_CATALOG, type PlanDefinition } from "./plans.config.js";
import {
  entitlementErrors,
  isValidEntitlements,
} from "./entitlements.schema.js";

export { BILLING_CONFIG, PLAN_CATALOG };
export type { PlanCode, PlanDefinition };
export * from "./entitlements.schema.js";

export const getPlanDefinition = (code: PlanCode): PlanDefinition => {
  const def = PLAN_CATALOG.find((p) => p.code === code);
  if (!def) throw new Error(`Plan "${code}" is not in the catalog`);
  return def;
};

/** Cents to charge for a year, from the monthly price and the catalog rule. */
export const annualPriceFor = (monthlyPrice: number): number =>
  monthlyPrice * BILLING_CONFIG.annualMonthsCharged;

/** Spend cap bounds for a plan in cents. Free plans have none: no overage. */
export const spendCapBoundsFor = (def: PlanDefinition) => {
  if (def.overagePricePer1k === null) {
    return { defaultCents: null, minCents: null, maxCents: null };
  }
  const { defaultMultiplier, minMultiplier, maxMultiplier } = BILLING_CONFIG.spendCap;
  return {
    defaultCents: Math.round(def.monthlyPrice * defaultMultiplier),
    minCents: Math.round(def.monthlyPrice * minMultiplier),
    maxCents: maxMultiplier === null ? null : Math.round(def.monthlyPrice * maxMultiplier),
  };
};

/**
 * The `plans` row for a catalog entry. The seed writes exactly this, so the
 * database never carries a number the catalog does not.
 */
export const planRowFromCatalog = (def: PlanDefinition, sortOrder: number) => {
  const caps = spendCapBoundsFor(def);
  return {
    code: def.code,
    name: def.name,
    description: def.description,
    monthlyPrice: def.monthlyPrice,
    yearlyPrice: annualPriceFor(def.monthlyPrice),
    currency: BILLING_CONFIG.currency,
    sortOrder,
    eventLimit: def.entitlements.events_per_period,
    websiteLimit: def.entitlements.sites,
    dataRetentionDays: def.entitlements.retention_days,
    overagePricePer1k: def.overagePricePer1k,
    // Deprecated mirror for the front ends still reading per-100k pricing.
    extraPricePer100k:
      def.overagePricePer1k === null ? null : def.overagePricePer1k * 100,
    spendCapDefaultCents: caps.defaultCents,
    spendCapMinCents: caps.minCents,
    spendCapMaxCents: caps.maxCents,
    entitlements: def.entitlements,
    isFree: def.monthlyPrice === 0 && def.overagePricePer1k === null,
    isPublic: def.isPublic,
    isActive: true,
  };
};

/**
 * Invariants the catalog must satisfy. Run by the seed and by the test suite so
 * a bad edit is caught before it reaches a database.
 */
export const validateCatalog = (catalog: readonly PlanDefinition[] = PLAN_CATALOG): string[] => {
  const problems: string[] = [];
  const codes = new Set<string>();

  for (const def of catalog) {
    if (codes.has(def.code)) problems.push(`duplicate plan code "${def.code}"`);
    codes.add(def.code);

    if (!isValidEntitlements(def.entitlements)) {
      problems.push(
        `plan "${def.code}" entitlements invalid: ${entitlementErrors(def.entitlements).join("; ")}`,
      );
    }
    if (def.monthlyPrice < 0) problems.push(`plan "${def.code}" has a negative price`);
    if (def.overagePricePer1k !== null && def.overagePricePer1k <= 0) {
      problems.push(`plan "${def.code}" overage price must be positive or null`);
    }
    if (def.monthlyPrice === 0 && def.overagePricePer1k !== null) {
      problems.push(`plan "${def.code}" is free but bills overage`);
    }
    const caps = spendCapBoundsFor(def);
    if (caps.defaultCents !== null && caps.minCents !== null && caps.defaultCents < caps.minCents) {
      problems.push(`plan "${def.code}" default spend cap is below its minimum`);
    }
  }

  const free = catalog.filter((p) => p.monthlyPrice === 0 && p.overagePricePer1k === null);
  if (free.length !== 1) problems.push(`expected exactly one free plan, found ${free.length}`);

  if (!codes.has(BILLING_CONFIG.trial.planCode)) {
    problems.push(`trial plan "${BILLING_CONFIG.trial.planCode}" is not in the catalog`);
  }

  return problems;
};
