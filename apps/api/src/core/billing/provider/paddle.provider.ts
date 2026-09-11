import { createHmac, timingSafeEqual } from "node:crypto";

import {
  ApiError,
  Environment,
  type Paddle,
  type Price,
  type Subscription,
  type Transaction,
} from "@paddle/paddle-node-sdk";

import {
  ProviderUnavailableError,
  type BillingProvider,
  type CheckoutConfig,
  type CheckoutHandle,
  type CheckoutInput,
  type OverageChargeInput,
  type ProviderEvent,
  type ProviderInvoice,
  type ProviderInvoiceLine,
  type ProviderSubscription,
  type ProviderSubscriptionItem,
} from "./billing-provider.js";

/**
 * Paddle Billing behind the BillingProvider interface. The only file that may
 * import the Paddle SDK.
 *
 * Paddle is the merchant of record: it charges the customer, remits tax and
 * pays out, so there are no card details, no invoice finalisation step and no
 * meters here. Three consequences shape this file:
 *
 *  - overage is a one-off charge built from a non-catalog price, priced from
 *    our own ledger. Paddle has no usage metering, so the arithmetic is ours;
 *  - Paddle has no idempotency for a subscription charge, so `chargeOverage`
 *    stamps its key in the price's custom data and looks for it before and
 *    after charging. A retry after a crash therefore cannot double-bill;
 *  - a deferred plan change is `do_not_bill`: the items change now and the new
 *    price is billed from the next renewal. Entitlements stay on the old plan
 *    until the local pending change applies, which is what the customer paid
 *    for.
 */
export class PaddleBillingProvider implements BillingProvider {
  readonly name = "paddle";

  constructor(
    private readonly paddle: Paddle,
    private readonly config: {
      /** Public token the dashboard needs to open Paddle.js checkout. */
      clientToken: string;
      environment: "sandbox" | "production";
    },
  ) {}

  async createCustomer(input: { email: string; name?: string; userId: string }) {
    try {
      const customer = await this.paddle.customers.create({
        email: input.email,
        name: input.name ?? null,
        customData: { userId: input.userId },
      });
      return { customerId: customer.id };
    } catch (err) {
      // Paddle keeps one customer per email forever, including archived ones,
      // so a re-registration or a lost local write must reuse it rather than
      // fail. Only this specific conflict is recovered.
      if (err instanceof ApiError && err.code === "customer_already_exists") {
        const existing = await this.findCustomerByEmail(input.email);
        if (existing) return { customerId: existing };
      }
      throw this.wrap(err);
    }
  }

  private async findCustomerByEmail(email: string): Promise<string | null> {
    const page = await this.call(() => this.paddle.customers.list({ email: [email], perPage: 2 }).next());
    return page.find((c) => c.email.toLowerCase() === email.toLowerCase())?.id ?? null;
  }

  /**
   * Paddle has no server-created hosted checkout without a payment link, so
   * checkout is its overlay: the dashboard loads paddle.js and opens it with
   * these values. The client token is public (it can only open a checkout).
   */
  async startCheckout(input: CheckoutInput): Promise<CheckoutHandle> {
    if (!this.config.clientToken) {
      throw new Error("PADDLE_CLIENT_TOKEN is not set, so checkout cannot be opened.");
    }
    return {
      kind: "overlay",
      provider: this.name,
      clientToken: this.config.clientToken,
      environment: this.config.environment,
      priceId: input.basePriceId,
      quantity: 1,
      customerId: input.customerId,
      customData: input.metadata,
      successUrl: input.successUrl,
    };
  }

  checkoutConfig(): CheckoutConfig {
    if (!this.config.clientToken) return null;
    return { provider: this.name, clientToken: this.config.clientToken, environment: this.config.environment };
  }

  /**
   * The portal is where the customer updates their payment method and sees
   * their invoices; Paddle owns both. Its links are single use, so they are
   * fetched per request and never stored.
   */
  async createPortalSession(input: { customerId: string; subscriptionIds: string[]; returnUrl: string }) {
    const session = await this.call(() =>
      this.paddle.customerPortalSessions.create(input.customerId, input.subscriptionIds.slice(0, 25)),
    );
    return { url: session.urls.general.overview };
  }

  async getSubscription(id: string) {
    const sub = await this.call(() => this.paddle.subscriptions.get(id));
    return toProviderSubscription(sub);
  }

  async changePlan(input: { providerSubscriptionId: string; basePriceId: string; billing: "prorate_now" | "defer" }) {
    // The items list replaces what is there: sending only the base price drops
    // anything else, which is right because a plan is one recurring price.
    const updated = await this.call(() =>
      this.paddle.subscriptions.update(input.providerSubscriptionId, {
        items: [{ priceId: input.basePriceId, quantity: 1 }],
        prorationBillingMode: input.billing === "prorate_now" ? "prorated_immediately" : "do_not_bill",
        // Never let an upgrade apply if its payment fails: the customer would
        // otherwise hold entitlements nobody paid for.
        onPaymentFailure: "prevent_change",
      }),
    );
    return toProviderSubscription(updated);
  }

  async scheduleCancellation(id: string) {
    const updated = await this.call(() => this.paddle.subscriptions.cancel(id, { effectiveFrom: "next_billing_period" }));
    return toProviderSubscription(updated);
  }

  async resumeSubscription(id: string) {
    // Clearing the scheduled change is how Paddle undoes a pending
    // cancellation. A subscription already canceled cannot be revived, and
    // Paddle rejects the call rather than pretending.
    const updated = await this.call(() => this.paddle.subscriptions.update(id, { scheduledChange: null }));
    return toProviderSubscription(updated);
  }

  async cancelNow(id: string) {
    const updated = await this.call(() => this.paddle.subscriptions.cancel(id, { effectiveFrom: "immediately" }));
    return toProviderSubscription(updated);
  }

  /**
   * Bill a closed period's overage. Charged immediately rather than deferred to
   * the next renewal, so an annual customer is billed monthly for usage as the
   * terms say, and a cancelling customer cannot walk away from it.
   */
  async chargeOverage(input: OverageChargeInput): Promise<{ transactionId: string | null }> {
    const already = await this.findChargeByKey(input.providerSubscriptionId, input.idempotencyKey);
    if (already) return { transactionId: already };

    const sub = await this.call(() => this.paddle.subscriptions.get(input.providerSubscriptionId));
    const recurring = sub.items.find((i) => i.recurring);
    const productId = recurring?.price?.productId;
    if (!productId) throw new Error(`subscription ${sub.id} has no recurring item to attach an overage charge to`);
    assertChargeCurrency(sub.currencyCode, input.currency);

    await this.call(() =>
      this.paddle.subscriptions.createOneTimeCharge(input.providerSubscriptionId, {
        effectiveFrom: "immediately",
        items: [
          {
            quantity: input.units,
            price: {
              productId,
              // Paddle caps the name at 50 characters; the dated description is
              // longer, and is the part the customer reads on the invoice line.
              description: input.description.slice(0, 200),
              name: "Extra events",
              unitPrice: { amount: String(input.unitPriceCents), currencyCode: input.currency.toUpperCase() as never },
              // Not customer visible. This is the idempotency record: the scan
              // above reads it back before charging again. Snake case, because
              // the SDK snake-cases custom data on the way out and returns it
              // as stored, so a camelCase key would never be found again.
              customData: { [CHARGE_KEY]: input.idempotencyKey },
              quantity: { minimum: 1, maximum: 1_000_000 },
            },
          },
        ],
        onPaymentFailure: "prevent_change",
      }),
    );

    // The charge endpoint answers with the subscription, not the transaction,
    // so the transaction is found by the same key that makes the call safe to
    // retry. Null only means "not visible yet"; the money is already charged.
    const transactionId = await this.findChargeByKey(input.providerSubscriptionId, input.idempotencyKey);
    return { transactionId };
  }

  /** The transaction carrying an overage charge with this key, if any. */
  private async findChargeByKey(providerSubscriptionId: string, key: string): Promise<string | null> {
    const page = await this.call(() =>
      this.paddle.transactions
        .list({ subscriptionId: [providerSubscriptionId], origin: ["subscription_charge"], perPage: 50, orderBy: "created_at[DESC]" })
        .next(),
    );
    const match = page.find((t) => t.items.some((i) => chargeKeyOf(i.price) === key));
    return match?.id ?? null;
  }

  async getTransaction(id: string) {
    const transaction = await this.call(() => this.paddle.transactions.get(id));
    return toProviderInvoice(transaction);
  }

  async listInvoices(customerId: string, limit = 12) {
    const page = await this.call(() =>
      this.paddle.transactions.list({ customerId: [customerId], perPage: limit, orderBy: "created_at[DESC]" }).next(),
    );
    return page.map(toProviderInvoice);
  }

  async invoicePdfUrl(id: string) {
    try {
      const pdf = await this.call(() => this.paddle.transactions.getInvoicePDF(id));
      return pdf.url;
    } catch (err) {
      // A draft, zero value or not-yet-billed transaction has no PDF. That is
      // an answer, not a failure.
      if (err instanceof ApiError) return null;
      throw err;
    }
  }

  /**
   * Verifies `Paddle-Signature` (HMAC-SHA256 over "<ts>:<raw body>") and the
   * timestamp window, then parses. The raw bytes matter: re-serialised JSON
   * never matches.
   *
   * Neither half uses the SDK.
   *
   * The check is ours because the SDK's returns a bare false, so a wrong
   * secret and a late delivery are indistinguishable in the log, and because
   * its window is five seconds: a latency spike, a slow first attempt or a
   * replay then loses a billing event permanently, which is far worse than the
   * replay risk the window guards against. That risk is already neutralised by
   * idempotency on the event id, where a repeated payload is answered
   * "duplicate" with no side effect. See SIGNATURE_MAX_AGE_SECONDS.
   *
   * The parse is a plain JSON.parse rather than the SDK's `unmarshal`, which
   * builds a typed entity per event and throws on any field it did not expect.
   * A verified payload must not be refused over a shape detail, and the
   * handlers re-read every object from the API anyway.
   */
  async parseWebhook(rawBody: Buffer, signature: string, secret: string): Promise<ProviderEvent> {
    const raw = rawBody.toString("utf8");
    verifySignature(raw, signature, secret);

    const parsed = JSON.parse(raw) as {
      event_id?: string;
      event_type?: string;
      occurred_at?: string;
      data?: unknown;
    };
    if (!parsed.event_id || !parsed.event_type) throw new Error("Paddle webhook payload has no event id or type");
    // event_id identifies the event; notification_id identifies the delivery
    // and repeats on a retry, so it must never be the idempotency key.
    return {
      id: parsed.event_id,
      type: parsed.event_type,
      createdAt: parsed.occurred_at ? new Date(parsed.occurred_at) : new Date(),
      data: parsed.data ?? {},
    };
  }

  /** Network and 5xx failures become ProviderUnavailableError so callers retry. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw this.wrap(err);
    }
  }

  private wrap(err: unknown): unknown {
    if (err instanceof ApiError) {
      // The SDK's message is the generic "Invalid request."; the code and the
      // field errors are what say why. Put them in the message, because that
      // message is what lands in usage_records.last_error and the log, and an
      // operator reading "Invalid request." there has nothing to act on.
      const fields = err.errors?.map((f) => `${f.field}: ${f.message}`).join("; ");
      const message = `${err.code}: ${err.detail}${fields ? ` (${fields})` : ""}`;
      // Paddle sets retryAfter on rate limits; its 5xx and internal errors are
      // typed "api_error". Everything else is our request being wrong, which a
      // retry cannot fix.
      if (err.retryAfter !== null || err.type === "api_error") {
        return new ProviderUnavailableError(message, err);
      }
      const described = new Error(message, { cause: err });
      described.name = "PaddleRequestError";
      return described;
    }
    if (err instanceof TypeError && /fetch failed|network/i.test(err.message)) {
      return new ProviderUnavailableError(err.message, err);
    }
    return err;
  }
}

// ─── Currency ───────────────────────────────────────────────────────────────

/**
 * Refuse to charge overage in a currency the subscription is not in.
 *
 * Verified in the sandbox: Paddle ignores the currency code on a one-off charge
 * item and bills the raw amount in the subscription's currency, so 80 USD cents
 * sent to a EUR subscription becomes 80 EUR cents, and to an INR subscription
 * 80 paise. A subscription lands in another currency only when the account has
 * automatic currency conversion on (Business Account > Currencies), which the
 * runbook says to leave off. This is the guard for the day someone turns it on:
 * a loud FAILED record instead of a silently wrong invoice.
 */
export const assertChargeCurrency = (subscriptionCurrency: string, chargeCurrency: string): void => {
  if (subscriptionCurrency.toUpperCase() === chargeCurrency.toUpperCase()) return;
  throw new Error(
    `subscription is billed in ${subscriptionCurrency.toUpperCase()} but overage is priced in ${chargeCurrency.toUpperCase()}; ` +
      "Paddle would bill the USD figure as-is in the subscription currency. Turn off automatic currency conversion " +
      "(Paddle > Business Account > Currencies) or add per-currency overage rates; not charged.",
  );
};

// ─── Signature ──────────────────────────────────────────────────────────────

/**
 * How old a signature may be.
 *
 * Paddle recommends five seconds. That is tighter than a network deserves:
 * every retry, every replay and any latency spike would be refused for good,
 * and a refused billing event has to be recovered by hand. Five minutes keeps
 * the window meaningful while surviving reality, and the endpoint's
 * idempotency (event id is the primary key of billing_events) is what actually
 * makes a captured payload useless to an attacker.
 */
export const SIGNATURE_MAX_AGE_SECONDS = 300;

/** Tolerance for the provider's clock running ahead of ours. */
const SIGNATURE_MAX_SKEW_SECONDS = 60;

/**
 * Throws unless the signature is genuine and recent. The message says which of
 * the two failed, because a wrong secret and a late delivery need different
 * fixes and look identical from the outside.
 */
export const verifySignature = (rawBody: string, signature: string, secret: string, now: Date = new Date()): void => {
  if (!secret) throw new Error("Paddle webhook secret is not configured");

  let ts = "";
  let h1 = "";
  for (const part of signature.split(";")) {
    const [key, value] = part.split("=");
    if (key === "ts" && value) ts = value;
    if (key === "h1" && value) h1 = value;
  }
  if (!ts || !h1 || !/^\d+$/.test(ts) || !/^[0-9a-f]+$/i.test(h1)) {
    throw new Error("Paddle webhook signature is malformed");
  }

  const ageSeconds = Math.floor(now.getTime() / 1000) - Number(ts);
  if (ageSeconds > SIGNATURE_MAX_AGE_SECONDS) {
    throw new Error(`Paddle webhook signature is ${ageSeconds}s old, over the ${SIGNATURE_MAX_AGE_SECONDS}s limit`);
  }
  if (ageSeconds < -SIGNATURE_MAX_SKEW_SECONDS) {
    throw new Error(`Paddle webhook signature is ${-ageSeconds}s in the future; check this server's clock`);
  }

  const expected = createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest();
  const received = Buffer.from(h1, "hex");
  // Compare in constant time, and only when the lengths already agree, since
  // timingSafeEqual throws on a mismatch rather than returning false.
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new Error("Paddle webhook signature does not match the configured secret");
  }
};

// ─── Mapping ────────────────────────────────────────────────────────────────

export const PADDLE_ENVIRONMENTS = { sandbox: Environment.sandbox, production: Environment.production } as const;

/** Custom-data field carrying an overage charge's idempotency key. */
export const CHARGE_KEY = "webyz_charge_key";

const chargeKeyOf = (price: Price | null): string | null => {
  const data = price?.customData as Record<string, unknown> | null | undefined;
  const key = data?.[CHARGE_KEY];
  return typeof key === "string" ? key : null;
};

const toItem = (item: Subscription["items"][number]): ProviderSubscriptionItem => ({
  priceId: item.price.id,
  quantity: item.quantity,
  interval: (item.price.billingCycle?.interval ?? "month") as ProviderSubscriptionItem["interval"],
  intervalCount: item.price.billingCycle?.frequency ?? 1,
  recurring: item.recurring,
});

const stringMetadata = (data: unknown): Record<string, string> => {
  if (!data || typeof data !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
};

export const toProviderSubscription = (sub: Subscription): ProviderSubscription => ({
  id: sub.id,
  customerId: sub.customerId,
  status: sub.status,
  items: sub.items.map(toItem),
  currency: sub.currencyCode,
  periodStart: sub.currentBillingPeriod ? new Date(sub.currentBillingPeriod.startsAt) : null,
  periodEnd: sub.currentBillingPeriod ? new Date(sub.currentBillingPeriod.endsAt) : null,
  // Paddle expresses a pending cancellation as a scheduled change. A pause is
  // deliberately not treated as one: it stops billing without ending anything.
  cancelAt:
    sub.scheduledChange?.action === "cancel" && sub.scheduledChange.effectiveAt
      ? new Date(sub.scheduledChange.effectiveAt)
      : null,
  canceledAt: sub.canceledAt ? new Date(sub.canceledAt) : null,
  metadata: stringMetadata(sub.customData),
});

const cents = (amount: string | null | undefined): number => {
  const n = Number(amount ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/** Paid means Paddle has the money: billed and past due do not. */
const PAID_STATUSES = new Set(["paid", "completed"]);

export const toProviderInvoice = (t: Transaction): ProviderInvoice => {
  const totals = t.details?.totals ?? null;
  const period = t.billingPeriod;
  const byPriceId = new Map(t.items.map((i) => [i.price?.id ?? "", i.price ?? null]));

  const lines: ProviderInvoiceLine[] = (t.details?.lineItems ?? []).map((line) => {
    const price = byPriceId.get(line.priceId) ?? null;
    return {
      // A charge line is overage when it carries our key; anything else on a
      // subscription transaction is the plan itself. The domain re-classifies
      // against the plan's own price ids (subscription/lifecycle.service.ts).
      kind: chargeKeyOf(price) !== null ? "usage" : price?.billingCycle ? "base" : "other",
      priceId: line.priceId,
      quantity: line.quantity,
      amountCents: cents(line.totals?.subtotal),
      periodStart: period ? new Date(period.startsAt) : null,
      periodEnd: period ? new Date(period.endsAt) : null,
      description: price?.description ?? null,
    };
  });

  const grandTotal = cents(totals?.grandTotal);
  return {
    id: t.id,
    customerId: t.customerId,
    providerSubscriptionId: t.subscriptionId,
    status: t.status,
    billingReason: t.origin,
    currency: t.currencyCode,
    subtotalCents: cents(totals?.subtotal),
    totalCents: grandTotal,
    amountPaidCents: PAID_STATUSES.has(t.status) ? grandTotal : 0,
    lines,
    number: t.invoiceNumber,
    // Paddle has no public invoice page; the PDF link is short lived and is
    // fetched on demand, never stored.
    hostedUrl: null,
    pdfUrl: null,
    createdAt: new Date(t.createdAt),
    billedAt: t.billedAt ? new Date(t.billedAt) : null,
    paidAt: PAID_STATUSES.has(t.status) && t.billedAt ? new Date(t.billedAt) : null,
  };
};
