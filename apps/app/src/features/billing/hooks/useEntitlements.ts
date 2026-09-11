import type { Plan } from "../types";
import { useUsageSummary } from "./useBilling";

export type Entitlements = Plan["entitlements"];
export type FeatureKey = {
  [K in keyof Entitlements]: Entitlements[K] extends boolean ? K : never;
}[keyof Entitlements];

/**
 * The current account's plan entitlements, from the same billing summary the
 * billing page renders. The API is the enforcement point (403
 * FEATURE_NOT_AVAILABLE); this only lets the UI hide what would fail and say
 * why. `entitlements` is null until the summary has loaded.
 */
export const useEntitlements = () => {
  const summary = useUsageSummary();
  return {
    entitlements: summary.data?.plan.entitlements ?? null,
    planName: summary.data?.plan.name ?? null,
    isLoading: summary.isLoading,
    hasFeature: (key: FeatureKey) => summary.data?.plan.entitlements[key] ?? false,
  };
};

/** The API's answer when a plan lacks a feature; see errors/domain-errors.ts in the API. */
export const isFeatureUnavailableError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: string }).code === "FEATURE_NOT_AVAILABLE";
