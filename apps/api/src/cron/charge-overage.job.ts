import prisma from "../lib/prisma.js";
import { getBillingProvider } from "../core/billing/provider/index.js";
import { chargeOverageForClosedPeriods } from "../core/billing/reporting/overage-charge.service.js";

/** Bill closed periods that accrued overage. The ledger is read-only here. */
export async function chargeOverageJob() {
  console.log("[cron] charge overage job");
  await chargeOverageForClosedPeriods({ prisma }, getBillingProvider());
}
