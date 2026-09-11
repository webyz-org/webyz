/**
 * Sandbox scenario: bill a closed period's overage for real.
 *
 *   npx tsx scripts/paddle/sandbox/overage-charge.ts --subscription sub_... [--events 502300]
 *
 * Writes a CLOSED usage period for the previous month onto the local
 * subscription bound to that provider subscription, with the given total
 * against the plan's allowance, then runs the charge job exactly as cron does.
 * The result is a real one-off charge on the real subscription, and the
 * webhook that follows records its transaction with a usage line, which is the
 * classification the reconciliation depends on.
 *
 * Sandbox only. The ledger row it writes is synthetic; delete it afterwards or
 * leave it as a worked example, it belongs to a test account either way.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../src/generated/prisma/client.js";
import { getBillingProvider } from "../../../src/core/billing/provider/index.js";
import { chargeOverageForClosedPeriods } from "../../../src/core/billing/reporting/overage-charge.service.js";
import { parseEntitlements } from "../../../src/core/billing/catalog/entitlements.schema.js";
import { addMonths } from "../../../src/core/billing/subscription/periods.js";

const apiKey = (process.env.PADDLE_API_KEY ?? "").trim();
if (!apiKey.includes("sdbx")) {
  console.error("Sandbox only: PADDLE_API_KEY must be a sandbox key.");
  process.exit(2);
}
const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const providerSubscriptionId = arg("--subscription");
const totalEvents = Number(arg("--events") ?? 502_300);
if (!providerSubscriptionId?.startsWith("sub_")) {
  console.error("Pass --subscription sub_...");
  process.exit(2);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const main = async () => {
  const sub = await prisma.subscription.findUniqueOrThrow({
    where: { providerSubscriptionId },
    include: { plan: true },
  });
  const included = parseEntitlements(sub.plan.entitlements).events_per_period;
  const overage = Math.max(0, totalEvents - included);
  if (!sub.currentPeriodStart) throw new Error("subscription has no current period");

  // The month before the current usage period, already closed.
  const periodEnd = sub.currentPeriodStart;
  const periodStart = addMonths(periodEnd, -1);
  const period = await prisma.billingPeriodUsage.upsert({
    where: { subscriptionId_periodStart: { subscriptionId: sub.id, periodStart } },
    update: { totalEvents: BigInt(totalEvents), includedEvents: BigInt(included), overageEvents: BigInt(overage), status: "CLOSED", closedAt: periodEnd },
    create: {
      subscriptionId: sub.id,
      periodStart,
      periodEnd,
      totalEvents: BigInt(totalEvents),
      includedEvents: BigInt(included),
      overageEvents: BigInt(overage),
      status: "CLOSED",
      closedAt: periodEnd,
    },
  });
  console.log(
    `closed period ${periodStart.toISOString().slice(0, 10)}..${periodEnd.toISOString().slice(0, 10)}: ${totalEvents} events, ${included} included, ${overage} over -> ` +
      `${Math.ceil(overage / 1000)} unit(s) x ${sub.plan.overagePricePer1k}c`,
  );

  const summary = await chargeOverageForClosedPeriods({ prisma }, getBillingProvider());
  console.log("charge job:", JSON.stringify(summary));

  const records = await prisma.usageRecord.findMany({ where: { billingPeriodUsageId: period.id }, orderBy: { createdAt: "asc" } });
  for (const r of records) {
    console.log(`usage_record ${r.status} delta=${r.deltaEvents} key=${r.idempotencyKey} transaction=${r.providerTransactionId ?? "-"} error=${r.lastError ?? "-"}`);
  }
  const after = await prisma.billingPeriodUsage.findUniqueOrThrow({ where: { id: period.id } });
  console.log(`checkpoint reported_events=${after.reportedEvents} (ledger overage ${after.overageEvents})`);
};

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
