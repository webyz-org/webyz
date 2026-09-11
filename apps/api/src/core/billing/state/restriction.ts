/**
 * The one authoritative decision of whether an account's ingest is restricted,
 * and why.
 *
 * Several flows can change the facts this decision depends on: payment
 * webhooks, grace expiry, spend-cap enforcement, a customer raising their cap,
 * quota enforcement, period rollover, trial start and expiry. None of them may
 * decide on their own whether to block or unblock. They change their fact, then
 * call `reconcileRestriction` (restriction.service.ts), which evaluates this
 * function over the complete state and writes the result to the subscription
 * row and every website of the account in one transaction.
 *
 * Invariant: if any blocking condition is currently true, ingest stays blocked
 * regardless of which event or job ran last.
 *
 * Precedence, highest first. Deterministic: the same facts always give the
 * same restriction.
 *
 *  1. PAYMENT_FAILED  status UNPAID, or PAST_DUE with the grace deadline passed.
 *                     The customer cannot lift this by their own action (a
 *                     higher cap, a new period); only payment does.
 *  2. SPEND_CAP       pay-as-you-go and the period's cost has reached the cap.
 *                     Customer controlled: raising the cap or a new period lifts
 *                     it, but never while (1) holds.
 *  3. FREE_QUOTA      hard-limit plan (free or trial) and the period's events
 *                     have reached the allowance. Lifted by the next period or
 *                     by moving to a plan with room, never while (1) or (2) hold.
 *  4. NONE            ingest on.
 *
 * PAST_DUE inside its grace window is not a restriction: dashboards and ingest
 * stay on until graceEndsAt, by design (14 day grace). PAST_DUE with no grace
 * deadline recorded is treated as still in grace; the lifecycle sync always
 * records one when a subscription enters arrears, so this only guards against
 * a half-written row and errs towards not blocking a paying customer.
 */

export type RestrictionKind = "NONE" | "FREE_QUOTA" | "SPEND_CAP" | "PAYMENT_FAILED";

export type RestrictionFacts = {
  status: "ACTIVE" | "CANCELED" | "PAST_DUE" | "TRIALING" | "INCOMPLETE" | "UNPAID";
  graceEndsAt: Date | null;
  /** Overage is billable: pay-as-you-go plan backed by a provider subscription. */
  isPayg: boolean;
  /** The current period's cost has reached the spending cap (pay-as-you-go only). */
  capReached: boolean;
  /** The current period's events have reached a hard-limit plan's allowance. */
  quotaReached: boolean;
};

export type RestrictionDecision = {
  restriction: RestrictionKind;
  /** True when the tracker must reject events for every site of the account. */
  blocked: boolean;
  /** Every condition that is currently true, so callers can notify on each. */
  reasons: { paymentFailed: boolean; capReached: boolean; quotaReached: boolean };
};

export const decideRestriction = (facts: RestrictionFacts, now: Date = new Date()): RestrictionDecision => {
  const paymentFailed =
    facts.status === "UNPAID" ||
    (facts.status === "PAST_DUE" && facts.graceEndsAt !== null && facts.graceEndsAt.getTime() <= now.getTime());
  const capReached = facts.isPayg && facts.capReached;
  const quotaReached = !facts.isPayg && facts.quotaReached;

  const restriction: RestrictionKind = paymentFailed
    ? "PAYMENT_FAILED"
    : capReached
      ? "SPEND_CAP"
      : quotaReached
        ? "FREE_QUOTA"
        : "NONE";

  return {
    restriction,
    blocked: restriction !== "NONE",
    reasons: { paymentFailed, capReached, quotaReached },
  };
};

/** Whether a hard-limit plan's allowance is used up. Zero allowance blocks on the first event. */
export const isQuotaReached = (totalEvents: number, includedEvents: number): boolean =>
  includedEvents <= 0 ? totalEvents > 0 : totalEvents >= includedEvents;
