import { syncUsageFromClickhouse } from "../core/billing/billing-cron.service.js";
import {
  backfillFreePlans,
  rollLocalUsagePeriods,
} from "../core/billing/free-plan.service.js";
import prisma from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { backfillTrials } from "../core/billing/trial/trial.service.js";

export async function syncUsageJob() {
  console.log("[cron] sync usage job");

  // Users from before free-plan assignment existed have no subscription row
  // and would otherwise never be metered.
  await backfillFreePlans({ prisma });

  // Rollout rule: accounts created within the configured window and never
  // trialled get the trial. Idempotent via users.trialUsedAt.
  await backfillTrials({ prisma, redis });

  // Free, trial and annual subscriptions have no provider event to move their
  // monthly window along, so roll them first; otherwise the quota would never
  // reset and usage would accumulate against a period that ended long ago.
  await rollLocalUsagePeriods({ prisma, redis });

  await syncUsageFromClickhouse();
}
