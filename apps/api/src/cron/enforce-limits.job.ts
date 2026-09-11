import { enforceUsageLimits } from "../core/billing/billing-cron.service.js";
import { expirePaymentGrace } from "../core/billing/subscription/lifecycle.service.js";
import { clickhouse } from "../lib/clickhouse.js";
import prisma from "../lib/prisma.js";
import { redis } from "../lib/redis.js";

export async function enforceLimitsJob() {
  console.log("[cron] enforce limits job");
  await expirePaymentGrace({ prisma, clickhouse, redis });
  await enforceUsageLimits();
}
