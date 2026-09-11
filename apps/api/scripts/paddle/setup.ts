/**
 * Provision the Paddle catalogue from the plan catalog.
 *
 *   npx tsx scripts/paddle/setup.ts [--webhook <url>] [--dry-run]
 *
 * Creates, idempotently, for every paid plan in
 * `src/core/billing/catalog/plans.config.ts`:
 *
 *   - one product, tagged `custom_data.webyz_plan = <code>`;
 *   - a monthly price and a yearly price on it, tagged with the plan code and
 *     the cycle, at the catalog's amounts;
 *
 * then writes the two price ids onto the matching `plans` row. Overage has no
 * price of its own: it is billed as a non-catalog item priced from
 * `overagePricePer1k`, so creating one here would be wrong.
 *
 * With `--webhook <url>` it also creates the notification destination with the
 * exact event list the code handles; `--webhook-only` does just that and leaves
 * the catalogue alone, which is how the destination is set up before the prices
 * are final. It never prints a secret: sync-webhook-secret.ts writes it into the
 * environment file, or copy it from Paddle > Developer tools > Notifications.
 *
 * Re-running is safe: everything is matched on the tags above and updated in
 * place, so the ids on the `plans` rows stay stable.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Environment, LogLevel, Paddle, type Price, type Product } from "@paddle/paddle-node-sdk";

import { PrismaClient } from "../../src/generated/prisma/client.js";
import { BILLING_CONFIG, PLAN_CATALOG, annualPriceFor, validateCatalog } from "../../src/core/billing/catalog/index.js";
import { PADDLE_HANDLED_EVENT_TYPES } from "../../src/core/billing/provider/paddle.webhooks.js";

const apiKey = (process.env.PADDLE_API_KEY ?? "").trim();
const dryRun = process.argv.includes("--dry-run");
const webhookUrl = process.argv[process.argv.indexOf("--webhook") + 1];
const wantsWebhook = process.argv.includes("--webhook");
const webhookOnly = process.argv.includes("--webhook-only");

if (!apiKey) {
  console.error("PADDLE_API_KEY is not set. Put the sandbox key in apps/api/.env first.");
  process.exit(2);
}

const isSandbox = apiKey.includes("sdbx");
if (!isSandbox && process.env.ALLOW_LIVE !== "1") {
  console.error(
    "This looks like a LIVE Paddle key. Provision the sandbox first, and re-run with ALLOW_LIVE=1 only when the prices are approved.",
  );
  process.exit(2);
}
if (!isSandbox && !BILLING_CONFIG.pricingFinal && !webhookOnly) {
  console.error("Refusing to create live prices while BILLING_CONFIG.pricingFinal is false: the amounts are modelling values.");
  process.exit(2);
}
if (webhookOnly && !wantsWebhook) {
  console.error("--webhook-only needs --webhook <url>.");
  process.exit(2);
}

const problems = validateCatalog();
if (problems.length) {
  for (const p of problems) console.error(`catalog: ${p}`);
  process.exit(2);
}

const paddle = new Paddle(apiKey, {
  environment: isSandbox ? Environment.sandbox : Environment.production,
  logLevel: LogLevel.error,
});
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const CURRENCY = BILLING_CONFIG.currency.toUpperCase();
/** How our own notification destination is recognised across URL changes. */
const DESTINATION_NAME = "Webyz API";
/** Analytics is software as a service; the tax category decides the rate Paddle charges. */
const TAX_CATEGORY = "saas" as const;

const marker = (price: Price | Product, key: string): string | null => {
  const data = price.customData as Record<string, unknown> | null | undefined;
  const value = data?.[key];
  return typeof value === "string" ? value : null;
};

const collect = async <T>(collection: { next: () => Promise<T[]>; hasMore: boolean }): Promise<T[]> => {
  const out: T[] = [];
  let page = await collection.next();
  while (page.length) {
    out.push(...page);
    if (!collection.hasMore) break;
    page = await collection.next();
  }
  return out;
};

const main = async () => {
  console.log(`Paddle ${isSandbox ? "sandbox" : "LIVE"}: ${webhookOnly ? "notification destination only" : "provisioning from the plan catalog"}${dryRun ? " (dry run)" : ""}\n`);

  if (!webhookOnly) await provisionCatalogue();
  if (wantsWebhook) await provisionWebhook();
  if (!dryRun && !webhookOnly) await reportRows();
};

const provisionCatalogue = async () => {
  const [products, prices] = await Promise.all([
    collect(paddle.products.list({ perPage: 200, status: ["active"] })),
    collect(paddle.prices.list({ perPage: 200, status: ["active"] })),
  ]);

  const paid = PLAN_CATALOG.filter((p) => p.monthlyPrice > 0);
  const rows: { plan: string; cycle: string; amount: string; priceId: string; action: string }[] = [];

  for (const plan of paid) {
    const wanted = { name: `Webyz ${plan.name}`, description: plan.description };

    let product = products.find((p) => marker(p, "webyz_plan") === plan.code) ?? null;
    let productId = product?.id ?? null;
    if (!product) {
      if (dryRun) {
        console.log(`would create product ${wanted.name}`);
        // Keep planning the prices so a dry run shows the whole change, not
        // just the first half of it.
        productId = "(new product)";
      } else {
        product = await paddle.products.create({
          name: wanted.name,
          description: wanted.description,
          taxCategory: TAX_CATEGORY,
          customData: { webyz_plan: plan.code },
        });
        productId = product.id;
        console.log(`created product ${product.id} ${wanted.name}`);
      }
    } else if (!dryRun && (product.name !== wanted.name || product.description !== wanted.description)) {
      product = await paddle.products.update(product.id, { name: wanted.name, description: wanted.description });
      console.log(`updated product ${product.id} ${wanted.name}`);
    }
    if (!productId) continue;

    const ids: Partial<Record<"monthly" | "yearly", string>> = {};

    for (const cycle of ["monthly", "yearly"] as const) {
      const amount = cycle === "monthly" ? plan.monthlyPrice : annualPriceFor(plan.monthlyPrice);
      const interval = cycle === "monthly" ? ("month" as const) : ("year" as const);
      const description = `${plan.name} plan, billed ${cycle === "monthly" ? "monthly" : "yearly"}`;

      const existing =
        prices.find((p) => marker(p, "webyz_plan") === plan.code && marker(p, "webyz_cycle") === cycle) ?? null;

      if (!existing) {
        if (dryRun) {
          rows.push({ plan: plan.name, cycle, amount: `${amount}c`, priceId: "-", action: "would create" });
          continue;
        }
        const created = await paddle.prices.create({
          productId,
          description,
          unitPrice: { amount: String(amount), currencyCode: CURRENCY as never },
          billingCycle: { interval, frequency: 1 },
          // One subscription is one plan: nobody buys five Growths.
          quantity: { minimum: 1, maximum: 1 },
          customData: { webyz_plan: plan.code, webyz_cycle: cycle },
        });
        ids[cycle] = created.id;
        rows.push({ plan: plan.name, cycle, amount: `${amount}c`, priceId: created.id, action: "created" });
        continue;
      }

      ids[cycle] = existing.id;
      const amountChanged = existing.unitPrice.amount !== String(amount);
      if (!dryRun && (amountChanged || existing.description !== description)) {
        // Paddle keeps existing subscriptions on the amount they signed up at,
        // so changing a price here only affects new checkouts.
        await paddle.prices.update(existing.id, {
          description,
          unitPrice: { amount: String(amount), currencyCode: CURRENCY as never },
        });
        rows.push({ plan: plan.name, cycle, amount: `${amount}c`, priceId: existing.id, action: amountChanged ? "amount updated" : "updated" });
      } else {
        rows.push({ plan: plan.name, cycle, amount: `${amount}c`, priceId: existing.id, action: "unchanged" });
      }
    }

    if (!dryRun && ids.monthly && ids.yearly) {
      await prisma.plan.update({
        where: { code: plan.code },
        data: { providerPriceMonthlyId: ids.monthly, providerPriceYearlyId: ids.yearly },
      });
    }
  }

  console.log("");
  console.log(["plan", "cycle", "amount", "price id", ""].join(" | "));
  for (const r of rows) console.log([r.plan, r.cycle, r.amount, r.priceId, r.action].join(" | "));
};

const provisionWebhook = async () => {
  {
    if (!webhookUrl || !webhookUrl.startsWith("http")) {
      console.error("\n--webhook needs a URL, e.g. --webhook https://api.example.com/api/v1/paddle/webhook");
      process.exitCode = 2;
    } else {
      const events = [...PADDLE_HANDLED_EVENT_TYPES].sort();
      const all = await paddle.notificationSettings.list();
      // Reuse ours by name, not by URL: a development tunnel gets a new
      // hostname every session, and a new destination would mean a new secret
      // to copy into the environment each time. Updating keeps the secret.
      const existing = all.find((n) => n.destination === webhookUrl) ?? all.find((n) => n.description === DESTINATION_NAME);
      if (dryRun) {
        console.log(`\nwould ${existing ? "update" : "create"} the notification destination ${webhookUrl} with ${events.length} events`);
      } else if (existing) {
        await paddle.notificationSettings.update(existing.id, { destination: webhookUrl, subscribedEvents: events as never, active: true });
        const moved = existing.destination !== webhookUrl;
        console.log(`\nupdated notification destination ${existing.id} -> ${webhookUrl} (${events.length} events)`);
        if (moved) console.log(`  was ${existing.destination}; the secret key is unchanged, so PADDLE_WEBHOOK_SECRET still applies`);
      } else {
        const created = await paddle.notificationSettings.create({
          description: DESTINATION_NAME,
          destination: webhookUrl,
          type: "url",
          subscribedEvents: events as never,
        });
        console.log(`\ncreated notification destination ${created.id} -> ${webhookUrl} (${events.length} events)`);
      }
      console.log("Copy its secret key from Paddle > Developer tools > Notifications into PADDLE_WEBHOOK_SECRET,");
      console.log("or run sync-webhook-secret.ts. This script never prints it.");
    }
  }
};

const reportRows = async () => {
  {
    const seeded = await prisma.plan.findMany({
      where: { isFree: false },
      select: { code: true, providerPriceMonthlyId: true, providerPriceYearlyId: true },
      orderBy: { sortOrder: "asc" },
    });
    const missing = seeded.filter((p) => !p.providerPriceMonthlyId || !p.providerPriceYearlyId);
    console.log(`\nplans rows carrying both price ids: ${seeded.length - missing.length}/${seeded.length}`);
    if (missing.length) console.log(`still missing: ${missing.map((m) => m.code).join(", ")}`);
    console.log("Paid plans become purchasable once PADDLE_API_KEY and PADDLE_CLIENT_TOKEN are both set.");
  }
};

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
