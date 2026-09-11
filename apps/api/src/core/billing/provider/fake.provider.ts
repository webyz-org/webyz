import {
  ProviderUnavailableError,
  type BillingProvider,
  type CheckoutConfig,
  type CheckoutHandle,
  type CheckoutInput,
  type OverageChargeInput,
  type ProviderEvent,
  type ProviderInvoice,
  type ProviderSubscription,
  type ProviderSubscriptionItem,
} from "./billing-provider.js";

/**
 * In-memory provider for tests. Models just enough Paddle behaviour to
 * exercise the domain: one recurring item per subscription, a billing period
 * that renews, monthly and annual intervals, cancellation at the period end, a
 * deferred price change that only bills from the next renewal, and one-off
 * overage charges deduplicated on their key. Every call is recorded, and any
 * method can be made to fail.
 */
export class FakeBillingProvider implements BillingProvider {
  readonly name = "fake";

  calls: { method: string; args: unknown[] }[] = [];
  customers = new Map<string, { email: string; userId: string }>();
  subscriptions = new Map<string, ProviderSubscription>();
  /** Overage charges keyed by idempotency key: only the first is kept. */
  charges = new Map<string, OverageChargeInput & { transactionId: string; at: Date }>();
  invoices = new Map<string, ProviderInvoice>();
  /** Prices the fake knows, so items get the right interval. */
  prices = new Map<string, { interval: "month" | "year" }>();

  /** Methods that should throw ProviderUnavailableError on their next call. */
  failNext = new Set<string>();
  /** Methods that always throw until cleared. */
  alwaysFail = new Set<string>();

  private seq = 0;
  private now: () => Date;

  constructor(opts: { now?: () => Date } = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  registerPrice(id: string, interval: "month" | "year") {
    this.prices.set(id, { interval });
  }

  private record(method: string, ...args: unknown[]) {
    this.calls.push({ method, args });
    if (this.alwaysFail.has(method) || this.failNext.delete(method)) {
      throw new ProviderUnavailableError(`fake provider: ${method} unavailable`);
    }
  }

  private id(prefix: string) {
    this.seq += 1;
    return `${prefix}_${String(this.seq).padStart(4, "0")}`;
  }

  private item(priceId: string): ProviderSubscriptionItem {
    const price = this.prices.get(priceId);
    if (!price) throw new Error(`fake provider: unknown price ${priceId}; call registerPrice first`);
    return { priceId, quantity: 1, interval: price.interval, intervalCount: 1, recurring: true };
  }

  private intervalOf(priceId: string) {
    const price = this.prices.get(priceId);
    if (!price) throw new Error(`fake provider: unknown price ${priceId}; call registerPrice first`);
    return price.interval;
  }

  async createCustomer(input: { email: string; name?: string; userId: string }) {
    this.record("createCustomer", input);
    const existing = [...this.customers].find(([, c]) => c.email === input.email);
    if (existing) return { customerId: existing[0] };
    const customerId = this.id("ctm");
    this.customers.set(customerId, { email: input.email, userId: input.userId });
    return { customerId };
  }

  async startCheckout(input: CheckoutInput): Promise<CheckoutHandle> {
    this.record("startCheckout", input);
    return {
      kind: "overlay",
      provider: this.name,
      clientToken: "test_token",
      environment: "sandbox",
      priceId: input.basePriceId,
      quantity: 1,
      customerId: input.customerId,
      customData: input.metadata,
      successUrl: input.successUrl,
    };
  }

  checkoutConfig(): CheckoutConfig {
    return { provider: this.name, clientToken: "test_token", environment: "sandbox" };
  }

  /**
   * Test helper standing in for the customer completing checkout: creates the
   * subscription the provider would have created, on its first period.
   */
  completeCheckout(input: {
    customerId: string;
    basePriceId: string;
    metadata?: Record<string, string>;
    start?: Date;
    status?: ProviderSubscription["status"];
  }): ProviderSubscription {
    const start = input.start ?? this.now();
    const sub: ProviderSubscription = {
      id: this.id("sub"),
      customerId: input.customerId,
      status: input.status ?? "active",
      items: [this.item(input.basePriceId)],
      currency: "usd",
      periodStart: start,
      periodEnd: addInterval(start, this.intervalOf(input.basePriceId)),
      cancelAt: null,
      canceledAt: null,
      metadata: input.metadata ?? {},
    };
    this.subscriptions.set(sub.id, sub);
    return sub;
  }

  async createPortalSession(input: { customerId: string; subscriptionIds: string[]; returnUrl: string }) {
    this.record("createPortalSession", input);
    return { url: `https://fake.portal/${input.customerId}` };
  }

  async getSubscription(id: string) {
    this.record("getSubscription", id);
    return clone(this.must(id));
  }

  /**
   * `prorate_now` swaps the price and keeps the period anchor, as an upgrade
   * does. `defer` leaves the current period alone and applies the new price at
   * the next renewal, which is what the deferred plan changes rely on.
   */
  async changePlan(input: { providerSubscriptionId: string; basePriceId: string; billing: "prorate_now" | "defer" }) {
    this.record("changePlan", input);
    const sub = this.must(input.providerSubscriptionId);
    const now = this.now();

    if (input.billing === "defer") {
      this.deferred.set(sub.id, input.basePriceId);
      // Paddle changes the entity's items immediately even when it bills
      // nothing; only the money waits for the renewal.
      sub.items = [this.item(input.basePriceId)];
      return clone(sub);
    }

    this.deferred.delete(sub.id);
    sub.items = [this.item(input.basePriceId)];
    const anchor = sub.periodStart ?? now;
    let start = anchor;
    let end = addInterval(start, this.intervalOf(input.basePriceId));
    while (end <= now) {
      start = end;
      end = addInterval(start, this.intervalOf(input.basePriceId));
    }
    sub.periodStart = start;
    sub.periodEnd = end;

    // Record a proration invoice so tests can assert one was produced.
    const invoiceId = this.id("txn");
    this.invoices.set(invoiceId, {
      id: invoiceId,
      customerId: sub.customerId,
      providerSubscriptionId: sub.id,
      status: "completed",
      billingReason: "subscription_update",
      currency: sub.currency,
      subtotalCents: 0,
      totalCents: 0,
      amountPaidCents: 0,
      lines: [],
      number: `FAKE-${this.seq}`,
      hostedUrl: null,
      pdfUrl: null,
      createdAt: now,
      billedAt: now,
      paidAt: now,
    });
    return clone(sub);
  }

  /** Deferred price changes: applied by `renew` at the next period boundary. */
  deferred = new Map<string, string>();

  async scheduleCancellation(id: string) {
    this.record("scheduleCancellation", id);
    const sub = this.must(id);
    sub.cancelAt = sub.periodEnd;
    return clone(sub);
  }

  async resumeSubscription(id: string) {
    this.record("resumeSubscription", id);
    const sub = this.must(id);
    if (sub.status === "canceled") throw new Error("fake provider: a canceled subscription cannot be resumed");
    sub.cancelAt = null;
    return clone(sub);
  }

  async cancelNow(id: string) {
    this.record("cancelNow", id);
    const sub = this.must(id);
    sub.status = "canceled";
    sub.cancelAt = null;
    sub.canceledAt = this.now();
    return clone(sub);
  }

  async chargeOverage(input: OverageChargeInput) {
    this.record("chargeOverage", input);
    const existing = this.charges.get(input.idempotencyKey);
    if (existing) return { transactionId: existing.transactionId };

    const sub = this.must(input.providerSubscriptionId);
    const now = this.now();
    const transactionId = this.id("txn");
    this.charges.set(input.idempotencyKey, { ...input, transactionId, at: now });
    const amount = input.units * input.unitPriceCents;
    this.invoices.set(transactionId, {
      id: transactionId,
      customerId: sub.customerId,
      providerSubscriptionId: sub.id,
      status: "completed",
      billingReason: "subscription_charge",
      currency: input.currency,
      subtotalCents: amount,
      totalCents: amount,
      amountPaidCents: amount,
      lines: [
        {
          kind: "usage",
          priceId: null,
          quantity: input.units,
          amountCents: amount,
          periodStart: null,
          periodEnd: null,
          description: input.description,
        },
      ],
      number: `FAKE-${this.seq}`,
      hostedUrl: null,
      pdfUrl: null,
      createdAt: now,
      billedAt: now,
      paidAt: now,
    });
    return { transactionId };
  }

  async getTransaction(id: string) {
    this.record("getTransaction", id);
    const inv = this.invoices.get(id);
    if (!inv) throw new Error(`fake provider: no transaction ${id}`);
    return clone(inv);
  }

  async listInvoices(customerId: string, limit = 12) {
    this.record("listInvoices", customerId, limit);
    return [...this.invoices.values()].filter((i) => i.customerId === customerId).slice(0, limit);
  }

  async invoicePdfUrl(id: string) {
    this.record("invoicePdfUrl", id);
    return this.invoices.has(id) ? `https://fake.invoice/${id}.pdf` : null;
  }

  async parseWebhook(rawBody: Buffer, _signature: string, _secret: string): Promise<ProviderEvent> {
    const parsed = JSON.parse(rawBody.toString("utf8"));
    return {
      id: parsed.event_id ?? parsed.id,
      type: parsed.event_type ?? parsed.type,
      createdAt: parsed.occurred_at ? new Date(parsed.occurred_at) : new Date(),
      data: parsed.data ?? parsed,
    };
  }

  // ── Test helpers that simulate provider-side time passing ─────────────────

  /** Renew the billing period if it has ended as of `now`, as the provider would. */
  renew(id: string, now: Date) {
    const sub = this.must(id);
    while (sub.periodEnd && sub.periodEnd <= now) {
      // A deferred change applies exactly at the boundary, with no proration.
      const deferredPrice = this.deferred.get(id);
      if (deferredPrice) {
        sub.items = [this.item(deferredPrice)];
        this.deferred.delete(id);
      }
      const interval = sub.items[0]?.interval ?? "month";
      sub.periodStart = sub.periodEnd;
      sub.periodEnd = addInterval(sub.periodEnd, interval);
    }
    if (sub.cancelAt && sub.cancelAt <= now) {
      sub.status = "canceled";
      sub.canceledAt = sub.cancelAt;
    }
    return clone(sub);
  }

  setStatus(id: string, status: ProviderSubscription["status"]) {
    this.must(id).status = status;
    return clone(this.must(id));
  }

  /** Units this fake billed for overage in [from, to). */
  billedUsageUnits(providerSubscriptionId: string, from: Date, to: Date) {
    let units = 0;
    for (const charge of this.charges.values()) {
      if (charge.providerSubscriptionId !== providerSubscriptionId) continue;
      if (charge.at >= from && charge.at < to) units += charge.units;
    }
    return units;
  }

  private must(id: string) {
    const sub = this.subscriptions.get(id);
    if (!sub) throw new Error(`fake provider: no subscription ${id}`);
    return sub;
  }
}

export const addInterval = (from: Date, interval: "day" | "week" | "month" | "year"): Date => {
  const d = new Date(from);
  if (interval === "day") d.setUTCDate(d.getUTCDate() + 1);
  else if (interval === "week") d.setUTCDate(d.getUTCDate() + 7);
  else if (interval === "month") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
};

const clone = <T>(v: T): T => structuredClone(v);
