import type { ProviderSubscription, ProviderSubscriptionItem } from "../provider/billing-provider.js";

/**
 * Pure period arithmetic. These are the rules that make annual plans work:
 *
 *  - the BASE period is the provider billing period: a month, or the prepaid
 *    year. Cancellation and the prepaid entitlement follow it;
 *  - the USAGE period is always about a month, because quotas and overage are
 *    monthly. For a monthly plan it is the base period; for an annual one it
 *    is a local window anchored to the base period start, since the provider
 *    only knows about the year.
 *
 * Nothing here reads a database or a clock it was not given.
 */

export type Period = { start: Date; end: Date };

/**
 * `months` calendar months after `from`, clamped to the end of a short month
 * so the 31st never silently becomes the 1st of the month after next.
 */
export const addMonths = (from: Date, months = 1): Date => {
  const day = from.getUTCDate();
  const out = new Date(from);
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, lastDay));
  return out;
};

/** The recurring item, which is the plan itself. One-off charges are not it. */
export const baseItemOf = (items: ProviderSubscriptionItem[]) => items.find((i) => i.recurring) ?? null;

export const deriveBillingCycle = (items: ProviderSubscriptionItem[]): "MONTHLY" | "YEARLY" =>
  baseItemOf(items)?.interval === "year" ? "YEARLY" : "MONTHLY";

export const deriveBasePeriod = (sub: Pick<ProviderSubscription, "periodStart" | "periodEnd">): Period | null =>
  sub.periodStart && sub.periodEnd ? { start: sub.periodStart, end: sub.periodEnd } : null;

/**
 * The monthly usage window containing `now`.
 *
 * Monthly plans use the provider period unchanged. Annual plans are walked
 * forward a month at a time from the base period start, so the window always
 * begins on the same day of the month the customer subscribed on and a
 * customer who pays yearly still gets a fresh allowance every month. `now`
 * before the base period (a renewal webhook arriving early) gives the first
 * window, never a window in the past.
 */
export const deriveUsagePeriod = (
  base: Period | null,
  billingCycle: "MONTHLY" | "YEARLY",
  now: Date,
): Period | null => {
  if (!base) return null;
  if (billingCycle === "MONTHLY") return base;

  // Every window is measured from the original anchor, never from the previous
  // window: walking month by month from a clamped date drifts (31 Jan, then 28
  // Feb, then 28 Mar instead of 31 Mar).
  let i = 0;
  let start = base.start;
  let end = addMonths(base.start, 1);
  // A year is 12 windows; the guard stops a bad date walking forever.
  while (i < 24 && end <= now && end < base.end) {
    i += 1;
    start = addMonths(base.start, i);
    end = addMonths(base.start, i + 1);
  }
  // The last window of a prepaid year is clipped to the year, so usage never
  // counts past what was paid for.
  return { start, end: end > base.end ? base.end : end };
};

export const isLiveProviderStatus = (status: ProviderSubscription["status"]) =>
  status === "active" || status === "trialing" || status === "past_due";
