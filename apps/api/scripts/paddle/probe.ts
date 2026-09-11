/**
 * Read-only report of the Paddle account and how it lines up with the plans.
 *
 *   npx tsx scripts/paddle/probe.ts
 *
 * Answers the questions worth asking before a first checkout: which
 * environment the key points at, what the catalogue holds, whether the `plans`
 * rows carry those price ids, and which notification destination is armed with
 * which events. It never prints a secret, only whether one is set.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Environment, LogLevel, Paddle } from "@paddle/paddle-node-sdk";

import { PrismaClient } from "../../src/generated/prisma/client.js";
import { PADDLE_HANDLED_EVENT_TYPES } from "../../src/core/billing/provider/paddle.webhooks.js";

const apiKey = (process.env.PADDLE_API_KEY ?? "").trim();
if (!apiKey) {
  console.error("PADDLE_API_KEY is not set.");
  process.exit(2);
}
const isSandbox = apiKey.includes("sdbx");
const paddle = new Paddle(apiKey, {
  environment: isSandbox ? Environment.sandbox : Environment.production,
  logLevel: LogLevel.error,
});
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const set = (name: string) => (process.env[name] ?? "").trim().length > 0;

const main = async () => {
  console.log(`environment: ${isSandbox ? "sandbox" : "LIVE"}`);
  console.log(`PADDLE_API_KEY set: yes`);
  console.log(`PADDLE_CLIENT_TOKEN set: ${set("PADDLE_CLIENT_TOKEN") ? "yes" : "NO (checkout cannot open)"}`);
  console.log(`PADDLE_WEBHOOK_SECRET set: ${set("PADDLE_WEBHOOK_SECRET") ? "yes" : "NO (webhooks are refused)"}`);
  console.log(`billing enabled: ${set("PADDLE_API_KEY") && set("PADDLE_CLIENT_TOKEN") ? "yes" : "no"}\n`);

  const products = await paddle.products.list({ perPage: 200, status: ["active"] }).next();
  const prices = await paddle.prices.list({ perPage: 200, status: ["active"] }).next();
  console.log(`products: ${products.length}, prices: ${prices.length}`);
  for (const price of prices) {
    const data = (price.customData ?? {}) as Record<string, unknown>;
    const tag = data.webyz_plan ? `${data.webyz_plan}/${data.webyz_cycle}` : "untagged";
    const cycle = price.billingCycle ? `${price.billingCycle.frequency} ${price.billingCycle.interval}` : "one-off";
    console.log(`  ${price.id}  ${tag.padEnd(18)} ${price.unitPrice.amount} ${price.unitPrice.currencyCode} / ${cycle}`);
  }

  const plans = await prisma.plan.findMany({
    select: { code: true, monthlyPrice: true, yearlyPrice: true, providerPriceMonthlyId: true, providerPriceYearlyId: true, isFree: true },
    orderBy: { sortOrder: "asc" },
  });
  console.log("\nplans rows:");
  const known = new Set(prices.map((p) => p.id));
  for (const plan of plans) {
    if (plan.isFree) {
      console.log(`  ${plan.code.padEnd(10)} free, no price needed`);
      continue;
    }
    const check = (id: string | null) => (!id ? "MISSING" : known.has(id) ? id : `${id} NOT IN THIS ACCOUNT`);
    console.log(`  ${plan.code.padEnd(10)} monthly ${check(plan.providerPriceMonthlyId)}  yearly ${check(plan.providerPriceYearlyId)}`);
  }

  const settings = await paddle.notificationSettings.list();
  console.log(`\nnotification destinations: ${settings.length}`);
  const handled = [...PADDLE_HANDLED_EVENT_TYPES].sort();
  const envSecret = (process.env.PADDLE_WEBHOOK_SECRET ?? "").trim();
  for (const s of settings) {
    const subscribed = new Set(s.subscribedEvents.map((e) => e.name as string));
    const missing = handled.filter((e) => !subscribed.has(e));
    console.log(`  ${s.id} ${s.active ? "active" : "inactive"} -> ${s.destination}`);
    console.log(`    events: ${subscribed.size}${missing.length ? `, MISSING ${missing.length}: ${missing.join(", ")}` : ", all handled events present"}`);
    // The comparison happens here and only its result is printed: a wrong
    // secret and a stale timestamp fail identically at the endpoint, so
    // knowing which is which is worth a line. Neither value is ever shown.
    const secret = (s as unknown as { endpointSecretKey?: string }).endpointSecretKey ?? "";
    if (!secret) console.log("    secret: not returned by the API, compare it by hand");
    else if (!envSecret) console.log(`    secret: PADDLE_WEBHOOK_SECRET is empty; the real one is ${secret.length} chars starting "pdl_ntfset_"`);
    else if (secret === envSecret) console.log("    secret: matches PADDLE_WEBHOOK_SECRET");
    else console.log(`    secret: DOES NOT MATCH PADDLE_WEBHOOK_SECRET (env has ${envSecret.length} chars, the real one has ${secret.length} and starts "pdl_ntfset_")`);
  }
  if (!settings.length) console.log("  none: no webhook will ever arrive, so no subscription will appear locally");
};

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
