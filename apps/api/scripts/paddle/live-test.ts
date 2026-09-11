/**
 * The live end-to-end test, one action per invocation, against the provider
 * account the environment points at. Every write refuses a live key unless
 * ALLOW_LIVE=1, and every action prints what it changed so the run is a record.
 *
 *   npx tsx scripts/paddle/live-test.ts discount create --code <CODE> [--hours 48]
 *       100% off, one use, one-time (renewals bill normally), restricted to the
 *       catalogue's prices, expiring in --hours. A real checkout at a $0 total.
 *   npx tsx scripts/paddle/live-test.ts discount archive <dsc_id>
 *   npx tsx scripts/paddle/live-test.ts subscription <sub_id>
 *       Provider view: status, items, periods, scheduled change, discount.
 *   npx tsx scripts/paddle/live-test.ts transaction <txn_id>
 *   npx tsx scripts/paddle/live-test.ts upgrade <sub_id> --price <pri_id>
 *       Swaps the single item to --price with proration_billing_mode
 *       do_not_bill: applied now, nothing charged.
 *   npx tsx scripts/paddle/live-test.ts cancel <sub_id> --period-end | --now
 *
 * inspect.ts --email shows the local side after each step; this script only
 * talks to the provider.
 */
import "dotenv/config";
import { Environment, LogLevel, Paddle } from "@paddle/paddle-node-sdk";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.js";

const apiKey = (process.env.PADDLE_API_KEY ?? "").trim();
if (!apiKey) {
  console.error("PADDLE_API_KEY is not set");
  process.exit(2);
}
const isSandbox = apiKey.includes("sdbx");
const paddle = new Paddle(apiKey, { environment: isSandbox ? Environment.sandbox : Environment.production, logLevel: LogLevel.error });

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
const has = (name: string) => rest.includes(name);

const guardWrite = () => {
  if (!isSandbox && process.env.ALLOW_LIVE !== "1") {
    console.error("LIVE key: re-run with ALLOW_LIVE=1 to write to the live account.");
    process.exit(2);
  }
};

const show = (label: string, value: unknown) => console.log(`${label}: ${JSON.stringify(value, null, 2)}`);

const catalogPriceIds = async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const plans = await prisma.plan.findMany({ where: { isFree: false } });
    return plans.flatMap((p) => [p.providerPriceMonthlyId, p.providerPriceYearlyId]).filter((id): id is string => Boolean(id));
  } finally {
    await prisma.$disconnect();
  }
};

const main = async () => {
  console.log(`environment: ${isSandbox ? "sandbox" : "LIVE"}`);

  switch (command) {
    case "discount": {
      const [action, id] = rest;
      if (action === "create") {
        guardWrite();
        const code = flag("--code");
        if (!code) throw new Error("--code <CODE> is required");
        const hours = Number(flag("--hours") ?? 48);
        const restrictTo = await catalogPriceIds();
        const discount = await paddle.discounts.create({
          description: "Live end-to-end test: one real checkout at a zero total",
          type: "percentage",
          amount: "100",
          enabledForCheckout: true,
          code,
          recur: false,
          usageLimit: 1,
          restrictTo,
          expiresAt: new Date(Date.now() + hours * 3_600_000).toISOString(),
          customData: { webyz_purpose: "live_test" },
        });
        show("created", { id: discount.id, code: discount.code, amount: discount.amount, type: discount.type, recur: discount.recur, usageLimit: discount.usageLimit, expiresAt: discount.expiresAt, restrictTo: discount.restrictTo, status: discount.status });
        return;
      }
      if (action === "archive") {
        guardWrite();
        if (!id) throw new Error("discount archive <dsc_id>");
        const discount = await paddle.discounts.archive(id);
        show("archived", { id: discount.id, code: discount.code, status: discount.status, timesUsed: discount.timesUsed });
        return;
      }
      throw new Error("discount create --code <CODE> | discount archive <dsc_id>");
    }

    case "subscription": {
      const id = rest[0];
      if (!id) throw new Error("subscription <sub_id>");
      const s = await paddle.subscriptions.get(id, { include: ["next_transaction", "recurring_transaction_details"] });
      show("subscription", {
        id: s.id,
        status: s.status,
        customerId: s.customerId,
        currency: s.currencyCode,
        items: s.items.map((i) => ({ priceId: i.price.id, name: i.price.name, quantity: i.quantity, status: i.status })),
        currentPeriod: s.currentBillingPeriod,
        nextBilledAt: s.nextBilledAt,
        scheduledChange: s.scheduledChange,
        discount: s.discount,
        canceledAt: s.canceledAt,
        nextTotal: s.nextTransaction?.details?.totals?.total ?? null,
      });
      return;
    }

    case "transaction": {
      const id = rest[0];
      if (!id) throw new Error("transaction <txn_id>");
      const t = await paddle.transactions.get(id);
      show("transaction", {
        id: t.id,
        status: t.status,
        origin: t.origin,
        subscriptionId: t.subscriptionId,
        customerId: t.customerId,
        currency: t.currencyCode,
        total: t.details?.totals?.total,
        grandTotal: t.details?.totals?.grandTotal,
        discountId: t.discountId,
        items: t.items.map((i) => ({ priceId: i.price?.id, quantity: i.quantity })),
        billedAt: t.billedAt,
      });
      return;
    }

    case "upgrade": {
      guardWrite();
      const id = rest[0];
      const priceId = flag("--price");
      if (!id || !priceId) throw new Error("upgrade <sub_id> --price <pri_id>");
      const s = await paddle.subscriptions.update(id, {
        items: [{ priceId, quantity: 1 }],
        prorationBillingMode: "do_not_bill",
      });
      show("updated", { id: s.id, status: s.status, items: s.items.map((i) => ({ priceId: i.price.id, name: i.price.name })), scheduledChange: s.scheduledChange });
      return;
    }

    case "cancel": {
      guardWrite();
      const id = rest[0];
      if (!id || (!has("--period-end") && !has("--now"))) throw new Error("cancel <sub_id> --period-end | --now");
      const s = await paddle.subscriptions.cancel(id, { effectiveFrom: has("--now") ? "immediately" : "next_billing_period" });
      show("cancelled", { id: s.id, status: s.status, scheduledChange: s.scheduledChange, canceledAt: s.canceledAt, currentPeriod: s.currentBillingPeriod });
      return;
    }

    default:
      console.error("commands: discount create|archive, subscription, transaction, upgrade, cancel");
      process.exit(2);
  }
};

main().catch((err) => {
  console.error("failed:", err?.message ?? err);
  if (err?.errors) console.error(JSON.stringify(err.errors, null, 2));
  process.exit(1);
});
