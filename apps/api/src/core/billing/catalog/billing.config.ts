/**
 * Billing behaviour that is not per plan. Every number the billing domain uses
 * that is not a plan attribute lives here. Nothing in core/ or cron/ may carry
 * its own copy.
 *
 * Values are development defaults agreed on 6 Sep 2026. Change them here, never
 * at the call site.
 */

/** Plan codes are the stable identity of a plan; ids differ per environment. */
export type PlanCode = "free" | "starter" | "growth" | "business";

export const BILLING_CONFIG = {
  /**
   * Whether the prices in plans.config.ts are the approved price list. While
   * false the seed logs a warning, the public plan list carries
   * `pricing.status: "placeholder"`, both pricing pages call the numbers
   * provisional, and the provisioning script refuses a live key. Approved on
   * 9 Sep 2026: Starter 9, Growth 19, Business 49 USD a month, ten months for
   * a year, overage 3c/2c/1c per 1,000 events.
   */
  pricingFinal: true,

  currency: "usd",

  /** Annual price = monthly price x this. 10 means two months free. */
  annualMonthsCharged: 10,

  trial: {
    enabled: true,
    days: 30,
    planCode: "growth" as PlanCode,
    /**
     * Rollout rule: existing accounts created within this many days of the
     * trial feature shipping get a trial; older accounts stay where they are.
     */
    grantToAccountsCreatedWithinDays: 30,
    /** Days before expiry at which reminders go out. */
    reminderDaysBefore: [7, 3] as readonly number[],
  },

  usage: {
    /**
     * Ratios of included events at which the customer is notified. Free plans
     * restrict at the last threshold; paid plans start overage there.
     */
    warnThresholds: {
      free: [0.8, 0.9, 1.0] as readonly number[],
      paid: [0.8, 0.9, 1.0] as readonly number[],
    },
    /** Events per billed unit. Customers always see events, never units. */
    meterUnitEvents: 1_000,
    /**
     * Smallest overage charge the provider will raise, in cents. Paddle refuses
     * a transaction under 70c USD (subscription_update_transaction_balance_
     * less_than_charge_limit, verified in the sandbox). A closed period whose
     * overage is worth less is waived, not carried: at most 69c a month per
     * customer, and the ledger still shows the events.
     */
    minChargeCents: 70,
    /** Hostnames whose traffic is stored but never billable. */
    nonBillableHostnames: ["localhost", "127.0.0.1", "::1", "[::1]"] as readonly string[],
  },

  spendCap: {
    /** Default cap = base monthly price x this. */
    defaultMultiplier: 2,
    /** Lowest cap a customer may set = base monthly price x this. */
    minMultiplier: 1,
    /** Highest cap, or null for no ceiling. */
    maxMultiplier: null as number | null,
    /** Ratio of the cap at which the "approaching" notification is sent. */
    approachingRatio: 0.9,
  },

  payment: {
    /** Days after a failed payment before ingest is restricted. */
    graceDays: 14,
  },
} as const;
