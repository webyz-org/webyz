import { BILLING_CONFIG } from "../catalog/billing.config.js";

/**
 * Pure usage arithmetic. Every number the billing page, the enforcement job
 * and the overage charger show or act on is derived here, from the ledger's
 * exact event counts. Nothing in this file touches a database or a provider.
 *
 * Money is in cents. Event counts are bigint at the storage boundary; inside
 * this module they are numbers, which is safe far beyond any real period.
 */

export type UsageInput = {
  /** Exact billable events in the period so far. */
  totalEvents: number;
  /** Events included by the plan for this period. */
  includedEvents: number;
  /** Cents per 1,000 overage events, or null for a hard-limit plan. */
  overagePricePer1k: number | null;
  /** Base price for the period in cents (monthly or yearly amount). */
  basePriceCents: number;
  /** Customer's spend cap in cents, base included. Null = plan default or none. */
  spendCapCents: number | null;
};

export type UsageComputation = {
  totalEvents: number;
  includedEvents: number;
  /** 0 when within the allowance. */
  overageEvents: number;
  /** Included events still available. 0 once over. */
  remainingIncluded: number;
  /** totalEvents / includedEvents. Infinity when includedEvents is 0 and total > 0. */
  usageRatio: number;
  /** Billable 1,000-event units, rounded up. 0 for hard-limit plans. */
  overageUnits: number;
  /** Cents the overage costs so far. 0 for hard-limit plans. */
  overageCents: number;
  /** base + overage, what the period would cost if it ended now. */
  currentBillCents: number;
  /** Whether the plan bills overage at all. */
  isPayAsYouGo: boolean;
  /** Effective cap in cents, or null when the plan has none. */
  spendCapCents: number | null;
  /** Cap minus current bill, floored at 0. Null when no cap. */
  capRemainingCents: number | null;
  /** True when currentBillCents >= spendCapCents. */
  capReached: boolean;
  /** True when currentBillCents >= cap * approachingRatio and not yet reached. */
  capApproaching: boolean;
};

const UNIT = BILLING_CONFIG.usage.meterUnitEvents;

export const computeUsage = (input: UsageInput): UsageComputation => {
  const total = Math.max(0, Math.floor(input.totalEvents));
  const included = Math.max(0, Math.floor(input.includedEvents));
  const isPayAsYouGo = input.overagePricePer1k !== null;

  const overageEvents = Math.max(0, total - included);
  const remainingIncluded = Math.max(0, included - total);
  const usageRatio = included === 0 ? (total > 0 ? Infinity : 0) : total / included;

  const overageUnits = isPayAsYouGo ? Math.ceil(overageEvents / UNIT) : 0;
  const overageCents = isPayAsYouGo ? overageUnits * (input.overagePricePer1k as number) : 0;
  const currentBillCents = input.basePriceCents + overageCents;

  const spendCapCents = isPayAsYouGo ? input.spendCapCents : null;
  const capRemainingCents =
    spendCapCents === null ? null : Math.max(0, spendCapCents - currentBillCents);
  const capReached = spendCapCents !== null && currentBillCents >= spendCapCents;
  const capApproaching =
    spendCapCents !== null &&
    !capReached &&
    currentBillCents >= spendCapCents * BILLING_CONFIG.spendCap.approachingRatio;

  return {
    totalEvents: total,
    includedEvents: included,
    overageEvents,
    remainingIncluded,
    usageRatio,
    overageUnits,
    overageCents,
    currentBillCents,
    isPayAsYouGo,
    spendCapCents,
    capRemainingCents,
    capReached,
    capApproaching,
  };
};

/**
 * How many overage events the cap still allows to be billed. Used by
 * enforcement to decide whether the next hour of traffic is affordable.
 * Infinity when there is no cap or no overage billing.
 */
export const eventsUntilCap = (u: UsageComputation, overagePricePer1k: number | null): number => {
  if (!u.isPayAsYouGo || u.spendCapCents === null || overagePricePer1k === null) return Infinity;
  if (u.capReached) return 0;
  const affordableUnits = Math.floor((u.capRemainingCents as number) / overagePricePer1k);
  // Events already inside the current partially-used unit are free until it fills.
  const slackInCurrentUnit = u.overageUnits * UNIT - u.overageEvents;
  return affordableUnits * UNIT + slackInCurrentUnit;
};

/**
 * Straight-line projection of period-end usage from elapsed time. Returns the
 * current total before any time has elapsed or after the period has ended.
 */
export const projectPeriodTotal = (
  totalEvents: number,
  periodStart: Date,
  periodEnd: Date,
  now: Date,
): number => {
  const length = periodEnd.getTime() - periodStart.getTime();
  const elapsed = now.getTime() - periodStart.getTime();
  if (length <= 0 || elapsed <= 0) return totalEvents;
  if (elapsed >= length) return totalEvents;
  return Math.round((totalEvents * length) / elapsed);
};

/**
 * Which warning threshold (0.8, 0.9, 1.0 ...) has been newly crossed, given
 * the highest one already sent. Null when nothing new.
 */
export const nextThresholdCrossed = (
  usageRatio: number,
  thresholds: readonly number[],
  lastWarned: number | null,
): number | null => {
  const crossed = thresholds.filter((t) => usageRatio >= t && (lastWarned ?? 0) < t);
  return crossed.length ? Math.max(...crossed) : null;
};

/** Floor a date to the start of its UTC hour. */
export const startOfHour = (d: Date): Date => {
  const ms = d.getTime();
  return new Date(ms - (ms % 3_600_000));
};

export type HourRow = { hour: Date; count: number };

/**
 * Split hourly counts into closed buckets (hours fully in the past) and the
 * live count for the current hour. Hours outside the period are dropped: a
 * ClickHouse row on the period end boundary belongs to the next period.
 */
export const splitHourRows = (
  rows: readonly HourRow[],
  periodStart: Date,
  periodEnd: Date,
  now: Date,
): { closed: HourRow[]; live: number } => {
  const currentHour = startOfHour(now).getTime();
  const closed: HourRow[] = [];
  let live = 0;

  for (const row of rows) {
    const t = row.hour.getTime();
    if (t < periodStart.getTime() || t >= periodEnd.getTime()) continue;
    if (t < currentHour) closed.push(row);
    else if (t === currentHour) live += row.count;
    // t > currentHour: future-dated events are ignored until their hour arrives.
  }

  return { closed, live };
};

export const sumCounts = (rows: readonly HourRow[]): number =>
  rows.reduce((acc, r) => acc + r.count, 0);

/** Base price per month for spend-cap maths: annual price / 12, rounded. */
export const monthlyEquivalentBase = (
  plan: { monthlyPrice: number; yearlyPrice: number },
  cycle: "MONTHLY" | "YEARLY",
): number => (cycle === "YEARLY" ? Math.round(plan.yearlyPrice / 12) : plan.monthlyPrice);
