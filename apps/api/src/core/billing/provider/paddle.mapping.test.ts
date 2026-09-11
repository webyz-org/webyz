import { test } from "node:test";
import assert from "node:assert/strict";

import { Subscription, Transaction } from "@paddle/paddle-node-sdk";

import { assertChargeCurrency, toProviderInvoice, toProviderSubscription } from "./paddle.provider.js";
import { deriveBillingCycle, deriveUsagePeriod, deriveBasePeriod } from "../subscription/periods.js";

/**
 * Provider mapping. The SDK entities are constructed from raw API shapes, so
 * this pins what the domain reads out of a real Paddle payload: the recurring
 * item, the billing period, a scheduled cancellation, and how a transaction's
 * lines become base and usage.
 */

const d = (s: string) => new Date(s);

const price = (id: string, interval: "month" | "year" | null, customData: unknown = null) => ({
  id,
  product_id: "pro_1",
  description: interval ? `Growth ${interval}` : "Extra events",
  name: null,
  type: "standard",
  billing_cycle: interval ? { interval, frequency: 1 } : null,
  trial_period: null,
  tax_mode: "account_setting",
  unit_price: { amount: "1900", currency_code: "USD" },
  unit_price_overrides: [],
  quantity: { minimum: 1, maximum: 100 },
  status: "active",
  created_at: "2026-09-05T00:00:00Z",
  updated_at: "2026-09-05T00:00:00Z",
  custom_data: customData,
  import_meta: null,
});

const subscriptionResponse = (over: Record<string, unknown> = {}) => ({
  id: "sub_01",
  status: "active",
  customer_id: "ctm_01",
  address_id: "add_01",
  business_id: null,
  currency_code: "USD",
  created_at: "2026-09-05T00:00:00Z",
  updated_at: "2026-09-05T00:00:00Z",
  started_at: "2026-09-05T00:00:00Z",
  first_billed_at: "2026-09-05T00:00:00Z",
  next_billed_at: "2027-09-05T00:00:00Z",
  paused_at: null,
  canceled_at: null,
  discount: null,
  collection_mode: "automatic",
  billing_details: null,
  current_billing_period: { starts_at: "2026-09-05T00:00:00Z", ends_at: "2027-09-05T00:00:00Z" },
  billing_cycle: { interval: "year", frequency: 1 },
  scheduled_change: null,
  management_urls: null,
  items: [
    {
      status: "active",
      quantity: 1,
      recurring: true,
      created_at: "2026-09-05T00:00:00Z",
      updated_at: "2026-09-05T00:00:00Z",
      previously_billed_at: null,
      next_billed_at: "2027-09-05T00:00:00Z",
      trial_dates: null,
      price: price("pri_year", "year"),
      product: { id: "pro_1", name: "Webyz Growth", tax_category: "standard", status: "active" },
    },
  ],
  custom_data: { userId: "u_1", planId: "p_1", billingCycle: "YEARLY", ignored: 7 },
  import_meta: null,
  ...over,
});

const asSubscription = (over: Record<string, unknown> = {}) =>
  new Subscription(subscriptionResponse(over) as never);

test("an annual subscription maps to one recurring item and the prepaid year", () => {
  const sub = toProviderSubscription(asSubscription());
  assert.equal(sub.id, "sub_01");
  assert.equal(sub.customerId, "ctm_01");
  assert.equal(sub.status, "active");
  assert.equal(sub.currency, "USD");
  assert.deepEqual(sub.items, [{ priceId: "pri_year", quantity: 1, interval: "year", intervalCount: 1, recurring: true }]);
  assert.equal(sub.periodStart?.toISOString(), "2026-09-05T00:00:00.000Z");
  assert.equal(sub.periodEnd?.toISOString(), "2027-09-05T00:00:00.000Z");
  assert.equal(sub.cancelAt, null);
  assert.equal(sub.canceledAt, null);

  // Only string custom data survives: the domain reads ids, never numbers.
  assert.deepEqual(sub.metadata, { userId: "u_1", planId: "p_1", billingCycle: "YEARLY" });

  // And that maps onto the domain's periods: a year of base, a month of usage.
  assert.equal(deriveBillingCycle(sub.items), "YEARLY");
  const base = deriveBasePeriod(sub);
  assert.equal(deriveUsagePeriod(base, "YEARLY", d("2026-09-20T00:00:00Z"))?.end.toISOString(), "2026-10-05T00:00:00.000Z");
});

test("a scheduled cancellation becomes cancelAt; a scheduled pause does not", () => {
  const canceling = toProviderSubscription(
    asSubscription({ scheduled_change: { action: "cancel", effective_at: "2027-09-05T00:00:00Z", resume_at: null } }),
  );
  assert.equal(canceling.cancelAt?.toISOString(), "2027-09-05T00:00:00.000Z");

  const pausing = toProviderSubscription(
    asSubscription({ scheduled_change: { action: "pause", effective_at: "2026-10-05T00:00:00Z", resume_at: null } }),
  );
  assert.equal(pausing.cancelAt, null, "a pause is not the end of the subscription");
});

test("a canceled subscription carries its end date", () => {
  const sub = toProviderSubscription(asSubscription({ status: "canceled", canceled_at: "2026-10-05T00:00:00Z" }));
  assert.equal(sub.status, "canceled");
  assert.equal(sub.canceledAt?.toISOString(), "2026-10-05T00:00:00.000Z");
});

test("a one-off charge item is not the plan", () => {
  const sub = toProviderSubscription(
    asSubscription({
      items: [
        { ...subscriptionResponse().items[0], recurring: false, price: price("pri_charge", null) },
        subscriptionResponse().items[0],
      ],
    }),
  );
  assert.equal(sub.items.filter((i) => i.recurring).length, 1);
  assert.equal(deriveBillingCycle(sub.items), "YEARLY", "the recurring item decides the cycle");
});

const transactionResponse = (over: Record<string, unknown> = {}) => ({
  id: "txn_01",
  status: "completed",
  customer_id: "ctm_01",
  address_id: "add_01",
  business_id: null,
  custom_data: null,
  currency_code: "USD",
  origin: "subscription_charge",
  subscription_id: "sub_01",
  invoice_id: "inv_01",
  invoice_number: "123-4567",
  collection_mode: "automatic",
  discount_id: null,
  billing_details: null,
  billing_period: { starts_at: "2026-09-05T00:00:00Z", ends_at: "2026-10-05T00:00:00Z" },
  items: [
    { price: price("pri_overage", null, { webyz_charge_key: "period-1:2300" }), quantity: 3, proration: null },
    { price: price("pri_year", "year"), quantity: 1, proration: null },
  ],
  details: {
    tax_rates_used: [],
    totals: {
      subtotal: "6",
      discount: "0",
      tax: "1",
      total: "7",
      credit: "0",
      credit_to_balance: "0",
      balance: "0",
      grand_total: "7",
      grand_total_tax: "1",
      fee: null,
      earnings: null,
      currency_code: "USD",
    },
    adjusted_totals: null,
    payout_totals: null,
    adjusted_payout_totals: null,
    line_items: [
      {
        id: "txnitm_01",
        price_id: "pri_overage",
        quantity: 3,
        proration: null,
        tax_rate: "0.2",
        unit_totals: { subtotal: "2", discount: "0", tax: "0", total: "2" },
        totals: { subtotal: "6", discount: "0", tax: "1", total: "7" },
        product: null,
      },
      {
        id: "txnitm_02",
        price_id: "pri_year",
        quantity: 1,
        proration: null,
        tax_rate: "0.2",
        unit_totals: { subtotal: "19000", discount: "0", tax: "0", total: "19000" },
        totals: { subtotal: "19000", discount: "0", tax: "0", total: "19000" },
        product: null,
      },
    ],
  },
  payments: [],
  checkout: null,
  created_at: "2026-10-05T00:00:00Z",
  updated_at: "2026-10-05T00:10:00Z",
  billed_at: "2026-10-05T00:05:00Z",
  revised_at: null,
  ...over,
});

test("a transaction maps to an invoice, with our charge key marking the usage line", () => {
  const inv = toProviderInvoice(new Transaction(transactionResponse() as never));
  assert.equal(inv.id, "txn_01");
  assert.equal(inv.providerSubscriptionId, "sub_01");
  assert.equal(inv.customerId, "ctm_01");
  assert.equal(inv.number, "123-4567");
  assert.equal(inv.billingReason, "subscription_charge");
  assert.equal(inv.subtotalCents, 6);
  assert.equal(inv.totalCents, 7);
  assert.equal(inv.amountPaidCents, 7, "completed means the money arrived");
  assert.equal(inv.billedAt?.toISOString(), "2026-10-05T00:05:00.000Z");

  // The line carrying the key we stamped is the overage; the recurring price is
  // the plan itself.
  assert.deepEqual(
    inv.lines.map((l) => [l.kind, l.priceId, l.quantity, l.amountCents]),
    [
      ["usage", "pri_overage", 3, 6],
      ["base", "pri_year", 1, 19_000],
    ],
  );
  // Paddle has no hosted invoice page, and its PDF link expires.
  assert.equal(inv.hostedUrl, null);
  assert.equal(inv.pdfUrl, null);
});

test("an unpaid transaction reports nothing paid", () => {
  for (const status of ["draft", "ready", "billed", "past_due", "canceled"]) {
    const inv = toProviderInvoice(new Transaction(transactionResponse({ status }) as never));
    assert.equal(inv.amountPaidCents, 0, status);
    assert.equal(inv.paidAt, null, status);
    assert.equal(inv.status, status);
  }
});

test("overage is never charged into a subscription billed in another currency", () => {
  // Paddle bills the raw figure in the subscription's currency, so 2 USD cents
  // sent to an INR subscription would become 2 paise. Refuse, loudly.
  assert.doesNotThrow(() => assertChargeCurrency("USD", "usd"));
  assert.throws(() => assertChargeCurrency("EUR", "USD"), /billed in EUR but overage is priced in USD/);
  assert.throws(() => assertChargeCurrency("INR", "USD"), /automatic currency conversion/);
});
