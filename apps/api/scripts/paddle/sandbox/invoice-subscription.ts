/**
 * Sandbox scenario: start a subscription without a card.
 *
 *   npx tsx scripts/paddle/sandbox/invoice-subscription.ts [--pay]
 *
 * Paddle's overlay checkout needs a human and a card, which makes the webhook
 * chain awkward to exercise from a terminal. A manually collected (invoice)
 * transaction reaches the same place: Paddle raises a real transaction, fires
 * real signed webhooks, and on payment creates a real subscription. That
 * exercises the ingress, the transaction mapping, `recordInvoice` and
 * `syncSubscription` against the live API rather than the fake.
 *
 * Sandbox only: it refuses any key that is not a sandbox key, and every object
 * it creates is tagged `webyz_sandbox` so it can be told apart.
 */
import "dotenv/config";
import { Environment, LogLevel, Paddle } from "@paddle/paddle-node-sdk";

const apiKey = (process.env.PADDLE_API_KEY ?? "").trim();
if (!apiKey.includes("sdbx")) {
  console.error("Sandbox only: PADDLE_API_KEY must be a sandbox key.");
  process.exit(2);
}
const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const priceId = arg("--price");
const pay = process.argv.includes("--pay");
/**
 * An existing customer, so the subscription lands on a real local account and
 * the whole chain resolves. Without it the webhook has no owner to attach to
 * and `syncSubscription` skips, which tests the ingress and nothing else.
 */
const existingCustomerId = arg("--customer");
const customData = arg("--custom-data");

const paddle = new Paddle(apiKey, { environment: Environment.sandbox, logLevel: LogLevel.error });

const main = async () => {
  if (!process.argv.includes("--price") || !priceId?.startsWith("pri_")) {
    console.error("Pass the price to subscribe to: --price pri_...");
    process.exit(2);
  }

  const stamp = Date.now();
  const customer = existingCustomerId
    ? await paddle.customers.get(existingCustomerId)
    : await paddle.customers.create({
        email: `sandbox+${stamp}@webyz.test`,
        name: "Sandbox scenario",
        customData: { webyz_sandbox: "invoice-subscription" },
      });
  console.log(`customer ${customer.id} ${customer.email}${existingCustomerId ? " (existing)" : ""}`);

  // Paddle needs an address to work out the tax on a billed transaction.
  const addresses = await paddle.addresses.list(customer.id, { perPage: 1 }).next();
  const address = addresses[0] ?? await paddle.addresses.create(customer.id, {
    countryCode: "US",
    postalCode: "94107",
    city: "San Francisco",
    region: "CA",
    firstLine: "1 Test Street",
    description: "Sandbox scenario",
  });
  console.log(`address  ${address.id}`);

  // status "billed" is what makes Paddle issue the invoice and fire
  // transaction.billed; a draft fires nothing we handle.
  const transaction = await paddle.transactions.create({
    items: [{ priceId, quantity: 1 }],
    customerId: customer.id,
    addressId: address.id,
    collectionMode: "manual",
    status: "billed",
    // Manual collection is an invoice, so Paddle insists on terms. 30 days is
    // the usual net; nothing here depends on the number.
    billingDetails: { enableCheckout: true, paymentTerms: { interval: "day", frequency: 30 } },
    customData: {
      webyz_sandbox: "invoice-subscription",
      ...(customData ? (JSON.parse(customData) as Record<string, string>) : {}),
    },
  });
  console.log(`transaction ${transaction.id} ${transaction.status}, total ${transaction.details?.totals?.grandTotal} ${transaction.currencyCode}`);
  console.log(`subscription so far: ${transaction.subscriptionId ?? "none until it is paid"}`);

  if (pay) {
    // Sandbox marks a manually collected transaction paid on request; live
    // accounts wait for the bank transfer.
    const paid = await paddle.transactions.update(transaction.id, { status: "paid" as never });
    console.log(`transaction ${paid.id} -> ${paid.status}, subscription ${paid.subscriptionId ?? "not yet"}`);
  }

  console.log("\nWatch the API log for [webhook] lines, then check billing_events and billing_invoices.");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
