/**
 * Both sides of one customer's billing, side by side.
 *
 *   npx tsx scripts/paddle/inspect.ts --email <account email>
 *
 * The local rows (subscriptions, usage periods, charge records, recorded
 * invoices, webhook events) next to what the provider holds for the same
 * customer (subscription, scheduled change, transactions). When a customer
 * says "I was charged twice" or "my plan did not change", this is the first
 * thing to run: the two halves either agree, or the line where they disagree
 * is the bug.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Environment, LogLevel, Paddle } from "@paddle/paddle-node-sdk";

import { PrismaClient } from "../../src/generated/prisma/client.js";

const apiKey = (process.env.PADDLE_API_KEY ?? "").trim();
const email = process.argv.includes("--email") ? process.argv[process.argv.indexOf("--email") + 1] : undefined;
if (!email) {
  console.error("Pass --email <account email>");
  process.exit(2);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const paddle = apiKey
  ? new Paddle(apiKey, { environment: apiKey.includes("sdbx") ? Environment.sandbox : Environment.production, logLevel: LogLevel.error })
  : null;

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "-");

const main = async () => {
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      subscriptions: {
        orderBy: { createdAt: "asc" },
        include: {
          plan: { select: { code: true } },
          billingPeriodUsages: { orderBy: { periodStart: "asc" }, include: { usageRecords: { orderBy: { createdAt: "asc" } } } },
          invoices: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (!user) {
    console.error(`no account with email ${email}`);
    process.exit(1);
  }

  console.log(`account ${user.email}  provider customer ${user.providerCustomerId ?? "-"}\n`);
  console.log("LOCAL");
  for (const s of user.subscriptions) {
    console.log(
      `  ${s.plan.code.padEnd(9)} ${s.status.padEnd(9)} ${s.billingCycle.padEnd(7)} restriction=${s.restriction.padEnd(14)} provider=${s.providerSubscriptionId ?? "-"}`,
    );
    console.log(
      `    usage ${day(s.currentPeriodStart)}..${day(s.currentPeriodEnd)}  base ${day(s.basePeriodStart)}..${day(s.basePeriodEnd)}  cancelAt=${day(s.cancelAt)}  pending=${s.pendingPlanId ? `${s.pendingBillingCycle} at ${day(s.pendingChangeAt)}` : "-"}`,
    );
    for (const p of s.billingPeriodUsages) {
      console.log(`    period ${day(p.periodStart)}..${day(p.periodEnd)} ${p.status.padEnd(6)} total=${p.totalEvents} included=${p.includedEvents} overage=${p.overageEvents} charged=${p.reportedEvents}`);
      for (const r of p.usageRecords) {
        console.log(`      record ${r.status.padEnd(6)} delta=${r.deltaEvents} transaction=${r.providerTransactionId ?? "-"}${r.lastError ? `  note: ${r.lastError.slice(0, 70)}` : ""}`);
      }
    }
    for (const i of s.invoices) {
      console.log(`    invoice ${i.providerInvoiceId} ${i.status.padEnd(9)} ${String(i.billingReason).padEnd(20)} total=${i.totalCents}c paid=${i.amountPaidCents}c base=${i.hasBaseLine} usage=${i.hasUsageLine} units=${i.usageUnits ?? "-"}`);
    }
  }

  const events = await prisma.billingEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 12, select: { type: true, status: true, error: true, receivedAt: true } });
  console.log(`\n  webhook events (latest ${events.length}, all accounts):`);
  for (const e of events) console.log(`    ${e.receivedAt.toISOString().slice(0, 19)} ${e.type.padEnd(24)} ${e.status}${e.error ? `  ${e.error.slice(0, 60)}` : ""}`);

  if (!paddle || !user.providerCustomerId) {
    console.log("\nPROVIDER: not configured or no customer id");
    return;
  }
  console.log("\nPROVIDER");
  // The user row holds one customer id, but a subscription can sit under
  // another (a different email typed at checkout), so read every customer the
  // account's subscriptions point at as well.
  const customerIds = new Set<string>([user.providerCustomerId]);
  for (const s of user.subscriptions) {
    if (!s.providerSubscriptionId) continue;
    try {
      customerIds.add((await paddle.subscriptions.get(s.providerSubscriptionId)).customerId);
    } catch {
      /* a subscription the provider no longer knows */
    }
  }
  if (customerIds.size > 1) console.log(`  customers: ${[...customerIds].join(", ")}`);
  const subs = await paddle.subscriptions.list({ customerId: [...customerIds], perPage: 20 }).next();
  for (const s of subs) {
    console.log(
      `  ${s.id} ${s.status.padEnd(9)} items=${s.items.map((i) => `${i.price.description} (${i.price.unitPrice.amount})`).join("; ")}  period ${s.currentBillingPeriod?.startsAt.slice(0, 10)}..${s.currentBillingPeriod?.endsAt.slice(0, 10)}  scheduled=${s.scheduledChange ? `${s.scheduledChange.action} at ${s.scheduledChange.effectiveAt.slice(0, 10)}` : "-"}`,
    );
  }
  const txns = await paddle.transactions.list({ customerId: [...customerIds], perPage: 20, orderBy: "id[DESC]" }).next();
  for (const t of txns) {
    console.log(`  ${t.id} ${t.origin.padEnd(22)} ${t.status.padEnd(9)} total=${t.details?.totals?.grandTotal} ${t.currencyCode}  ${t.items.map((i) => `${i.price?.description} x${i.quantity}`).join("; ")}`);
  }
};

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
