/**
 * The one place a subscription's raw fields become "what can this account do".
 *
 * Provider lifecycle statuses (ACTIVE, TRIALING, PAST_DUE, ...) stay on the row
 * as the provider reports them. Everything else in the app asks this module
 * and never compares statuses itself.
 */

export type AccessState =
  /** Active on the free plan. Ingest on until the free quota. */
  | "FREE"
  /** Inside a free trial of a paid plan. */
  | "TRIAL"
  /** Paying, in good standing. */
  | "PAID"
  /** A payment failed; dashboards open, ingest on, until graceEndsAt. */
  | "GRACE"
  /** Ingest is off for the reason in `restriction`. Dashboards stay readable. */
  | "RESTRICTED"
  /** Subscription is over. A free one should replace it. */
  | "ENDED";

export type RestrictionReason =
  | "NONE"
  | "FREE_QUOTA"
  | "SPEND_CAP"
  | "PAYMENT_FAILED"
  | "TRIAL_ENDED";

export type SubscriptionSnapshot = {
  status:
    | "ACTIVE"
    | "CANCELED"
    | "PAST_DUE"
    | "TRIALING"
    | "INCOMPLETE"
    | "UNPAID";
  restriction: RestrictionReason;
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
  providerSubscriptionId: string | null;
  plan: { isFree: boolean };
};

export type Access = {
  state: AccessState;
  /** True when the tracker may write events for this account's sites. */
  ingestAllowed: boolean;
  /** True when the account's dashboards may be viewed. Always true today. */
  dashboardAllowed: boolean;
  /** Set for RESTRICTED and GRACE so the UI can explain itself. */
  reason: RestrictionReason | "PAYMENT_GRACE" | null;
  /** When the current GRACE or TRIAL window ends, if it has one. */
  until: Date | null;
};

export const deriveAccess = (
  sub: SubscriptionSnapshot | null,
  now: Date = new Date(),
): Access => {
  // No live subscription at all. The backfill job will create a free one; until
  // then behave as free so nothing is blocked for lack of a row.
  if (!sub) return access("FREE", true, null, null);

  if (sub.restriction !== "NONE") {
    return access("RESTRICTED", false, sub.restriction, null);
  }

  switch (sub.status) {
    case "CANCELED":
    case "INCOMPLETE":
      return access("ENDED", false, null, null);

    case "UNPAID":
      // The provider has stopped retrying but kept the subscription. For an annual
      // customer this can be a failed monthly overage invoice; the prepaid
      // year is not revoked. Ingest stops, dashboards stay, until paid.
      return access("RESTRICTED", false, "PAYMENT_FAILED", null);

    case "PAST_DUE": {
      // Grace is bounded. Once it lapses the enforcement job sets
      // restriction=PAYMENT_FAILED; until it does, stay in GRACE but say so.
      const until = sub.graceEndsAt;
      return access("GRACE", true, "PAYMENT_GRACE", until);
    }

    case "TRIALING": {
      // A local trial has no provider subscription and a trial end date. A provider
      // trial (not used today) would carry a subscription id; treat it as paid.
      if (!sub.providerSubscriptionId && sub.trialEndsAt && sub.trialEndsAt > now) {
        return access("TRIAL", true, null, sub.trialEndsAt);
      }
      if (!sub.providerSubscriptionId) {
        // Past its end date but not yet expired by the job. Still a trial, the
        // job will move it to Free within the hour. Do not block early.
        return access("TRIAL", true, null, sub.trialEndsAt);
      }
      return access("PAID", true, null, null);
    }

    case "ACTIVE":
      return sub.plan.isFree
        ? access("FREE", true, null, null)
        : access("PAID", true, null, null);
  }
};

const access = (
  state: AccessState,
  ingestAllowed: boolean,
  reason: Access["reason"],
  until: Date | null,
): Access => ({ state, ingestAllowed, dashboardAllowed: true, reason, until });

/** True when a status still grants the plan's entitlements. */
export const isLiveStatus = (status: SubscriptionSnapshot["status"]) =>
  status === "ACTIVE" || status === "TRIALING" || status === "PAST_DUE";
