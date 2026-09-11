import { badRequest } from "../../../errors/http-errors.js";

/** The provider price id a plan needs for a given cycle, or a clear reason why not. */
export const resolvePrices = (
  plan: {
    name: string;
    isFree: boolean;
    isActive: boolean;
    providerPriceMonthlyId: string | null;
    providerPriceYearlyId: string | null;
  },
  billingCycle: "MONTHLY" | "YEARLY",
) => {
  if (!plan.isActive) throw badRequest("Plan is no longer available");
  if (plan.isFree) throw badRequest("Free plan does not need checkout");

  const basePriceId = billingCycle === "YEARLY" ? plan.providerPriceYearlyId : plan.providerPriceMonthlyId;
  if (!basePriceId) {
    throw badRequest(`${plan.name} cannot be purchased ${billingCycle.toLowerCase()} yet: no price is configured.`);
  }
  // Overage has no price of its own: it is charged from the ledger at the
  // plan's own per-1,000 rate (see reporting/overage-charge.service.ts).
  return { basePriceId };
};
