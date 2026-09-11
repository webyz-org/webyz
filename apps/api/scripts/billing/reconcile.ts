/**
 * Billing reconciliation report.
 *
 *   npx tsx scripts/billing/reconcile.ts [--days 35] [--no-provider]
 *
 * Compares, for every closed pay-as-you-go usage period in the window: the
 * ledger's overage, the charging checkpoint, the charge transaction at the
 * provider and the units and amount on its invoice line. Prints one row per period and every finding, and
 * exits 1 when any finding exists so it can run in CI or cron. Read-only.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.js";
import { getBillingProvider, hasBillingProvider } from "../../src/core/billing/provider/index.js";
import { reconcileClosedPeriods } from "../../src/core/billing/reconciliation/reconcile.service.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const days = Number(arg("--days") ?? 35);
const useProvider = !process.argv.includes("--no-provider") && hasBillingProvider();

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const main = async () => {
  const rows = await reconcileClosedPeriods({ prisma }, useProvider ? getBillingProvider() : null, { sinceDays: days });
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  console.log(`reconciliation: ${rows.length} closed period(s) in the last ${days} days${useProvider ? "" : " (provider skipped)"}\n`);
  console.log(["period", "customer", "ledger", "charged", "transaction", "units", "amount", "findings"].join(" | "));
  let problems = 0;
  for (const r of rows) {
    problems += r.findings.length;
    console.log(
      [
        `${fmt(r.periodStart)}..${fmt(r.periodEnd)}`,
        r.userEmail,
        r.ledgerOverage,
        r.reportedEvents,
        r.transactionId ? `${r.transactionId} (${r.transactionStatus ?? "?"})` : "-",
        `${r.invoiceUnits ?? "-"}/${r.expectedUnits}`,
        `${r.invoiceAmountCents ?? "-"}/${r.expectedAmountCents ?? "-"}`,
        r.findings.length ? r.findings.join("; ") : "ok",
      ].join(" | "),
    );
  }
  console.log(`\n${problems} finding(s)`);
  process.exit(problems ? 1 : 0);
};

main()
  .catch((err) => {
    console.error(err);
    process.exit(2);
  })
  .finally(() => prisma.$disconnect());
