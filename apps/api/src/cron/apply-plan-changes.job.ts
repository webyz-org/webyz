import prisma from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { getBillingProvider } from "../core/billing/provider/index.js";
import { applyDuePlanChanges } from "../core/billing/subscription/plan-change.service.js";
import { clickhouse } from "../lib/clickhouse.js";

/**
 * Move scheduled downgrades onto the local plan once the period the customer
 * paid for has ended. The provider has already been billing the new price
 * since that boundary; this is the entitlement half of the same change.
 */
export async function applyPlanChangesJob() {
  console.log("[cron] apply plan changes job");
  await applyDuePlanChanges({ prisma, redis, clickhouse }, getBillingProvider());
}
