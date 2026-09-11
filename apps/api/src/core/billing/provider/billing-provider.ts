/**
 * The billing provider boundary.
 *
 * Everything the Webyz billing domain needs from a payment provider, in Webyz
 * terms. Only `provider/*.provider.ts` files import a vendor SDK. The domain
 * (usage, entitlements, enforcement, subscriptions, trial, spend cap) speaks
 * to this interface and nothing else, so replacing the provider is a new file
 * here.
 *
 * The shape follows what a merchant of record can actually do, which is less
 * than a direct payment processor offers, and drove two rules:
 *
 *  - there is no metered price. Overage is computed from our own ledger and
 *    billed as a one-off charge on the subscription (`chargeOverage`), so a
 *    plan is one recurring price and nothing else;
 *  - there is no provider-side schedule for a plan change. A deferred
 *    downgrade is `changePlan` with `billing: "defer"` (the provider bills the
 *    new price from the next renewal and charges nothing now) plus a local
 *    pending record that governs entitlements until it applies.
 */

export type ProviderInterval = "day" | "week" | "month" | "year";

export type ProviderSubscriptionItem = {
  priceId: string;
  quantity: number;
  interval: ProviderInterval;
  intervalCount: number;
  /** False for a one-off charge item riding on the subscription. */
  recurring: boolean;
};

export type ProviderSubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "paused"
  | "canceled";

export type ProviderSubscription = {
  id: string;
  customerId: string;
  status: ProviderSubscriptionStatus;
  items: ProviderSubscriptionItem[];
  currency: string;
  /**
   * The provider billing period: a month for monthly plans, the prepaid year
   * for annual ones. Monthly usage windows are derived from it locally
   * (subscription/periods.ts), because quotas are always monthly.
   */
  periodStart: Date | null;
  periodEnd: Date | null;
  /** Scheduled cancellation date, or null. */
  cancelAt: Date | null;
  canceledAt: Date | null;
  /** What we attached at checkout: userId, planId, billingCycle. */
  metadata: Record<string, string>;
};

export type ProviderInvoiceLine = {
  kind: "base" | "usage" | "other";
  priceId: string | null;
  quantity: number | null;
  amountCents: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  description: string | null;
};

export type ProviderInvoice = {
  id: string;
  customerId: string | null;
  providerSubscriptionId: string | null;
  status: string;
  /** Why the provider raised it: renewal, one-off charge, plan change. */
  billingReason: string | null;
  currency: string;
  subtotalCents: number;
  totalCents: number;
  amountPaidCents: number;
  lines: ProviderInvoiceLine[];
  /** The provider's human invoice number, once issued. */
  number: string | null;
  /** A page where the customer can view or pay it, when the provider has one. */
  hostedUrl: string | null;
  /** Short-lived PDF link. Fetch on demand with `invoicePdfUrl`, never store. */
  pdfUrl: string | null;
  createdAt: Date;
  billedAt: Date | null;
  paidAt: Date | null;
};

export type CheckoutInput = {
  customerId: string;
  /** The recurring price for the base plan. */
  basePriceId: string;
  metadata: Record<string, string>;
  successUrl: string;
};

/**
 * How the browser must start checkout. `redirect` is a hosted page; `overlay`
 * is the provider's own script, opened by the dashboard with these values.
 * The client token is public by design and comes from the API so a self-hosted
 * dashboard image never has to be rebuilt to carry it.
 */
export type CheckoutHandle =
  | { kind: "redirect"; url: string }
  | {
      kind: "overlay";
      provider: string;
      clientToken: string;
      environment: "sandbox" | "production";
      priceId: string;
      quantity: number;
      customerId: string;
      customData: Record<string, string>;
      successUrl: string;
    };

/**
 * Enough to initialise the provider's script with no purchase in mind, so a
 * page can pick up a payment the provider sent the customer to finish (a
 * `_ptxn` parameter on the billing page). Null for a provider without a script.
 */
export type CheckoutConfig = {
  provider: string;
  clientToken: string;
  environment: "sandbox" | "production";
} | null;

export type OverageChargeInput = {
  providerSubscriptionId: string;
  /** Units to bill: ceil(overage events / meter unit). Always at least 1. */
  units: number;
  unitPriceCents: number;
  currency: string;
  /** Shown to the customer on the invoice line. */
  description: string;
  /**
   * Stable per checkpoint. The provider implementation must make a repeat call
   * with the same key a no-op that returns the original transaction, because a
   * crash between charging and recording is retried.
   */
  idempotencyKey: string;
};

export type ProviderEvent = {
  id: string;
  type: string;
  createdAt: Date;
  /** The vendor object, opaque to the domain. Handlers narrow it. */
  data: unknown;
};

/** Thrown by providers for failures the caller should retry later. */
export class ProviderUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export interface BillingProvider {
  /** Stored on billing_events, billing_invoices and usage_records. */
  readonly name: string;

  createCustomer(input: { email: string; name?: string; userId: string }): Promise<{ customerId: string }>;

  startCheckout(input: CheckoutInput): Promise<CheckoutHandle>;

  /** The public script configuration, for pages that must open a checkout the provider initiated. */
  checkoutConfig(): CheckoutConfig;

  createPortalSession(input: {
    customerId: string;
    /** The customer's live subscriptions, so the portal can manage them. */
    subscriptionIds: string[];
    returnUrl: string;
  }): Promise<{ url: string }>;

  getSubscription(id: string): Promise<ProviderSubscription>;

  /**
   * Move the subscription to `basePriceId`.
   *
   * `prorate_now` charges the difference for the rest of the period and is
   * used for upgrades. `defer` changes nothing about money now: the provider
   * bills the new price from the next renewal, which is what a downgrade owes.
   */
  changePlan(input: {
    providerSubscriptionId: string;
    basePriceId: string;
    billing: "prorate_now" | "defer";
  }): Promise<ProviderSubscription>;

  /** Cancel at the end of the period the customer has paid for. */
  scheduleCancellation(id: string): Promise<ProviderSubscription>;

  /** Undo a scheduled cancellation. */
  resumeSubscription(id: string): Promise<ProviderSubscription>;

  /** End it immediately, billing anything outstanding. Account deletion only. */
  cancelNow(id: string): Promise<ProviderSubscription>;

  /**
   * Bill a closed period's overage as a one-off charge on the subscription.
   * A null transaction id means the charge went through but the provider has
   * not surfaced the transaction yet; it is a note, not a failure.
   */
  chargeOverage(input: OverageChargeInput): Promise<{ transactionId: string | null }>;

  getTransaction(id: string): Promise<ProviderInvoice>;

  listInvoices(customerId: string, limit?: number): Promise<ProviderInvoice[]>;

  /** A short-lived link to the PDF, or null while the provider has none yet. */
  invoicePdfUrl(id: string): Promise<string | null>;

  /** Verify the signature over the exact bytes received, then parse. */
  parseWebhook(rawBody: Buffer, signature: string, secret: string): Promise<ProviderEvent>;
}
