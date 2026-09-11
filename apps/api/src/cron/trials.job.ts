import { expireTrials, sendTrialReminders } from "../core/billing/trial/trial.service.js";
import prisma from "../lib/prisma.js";
import { redis } from "../lib/redis.js";

/** Hourly: move ended trials to Free (never deleting data) and send reminders once. */
export async function trialsJob() {
  console.log("[cron] trials job");
  const ctx = { prisma, redis };
  const expired = await expireTrials(ctx);
  const reminded = await sendTrialReminders(ctx);
  console.log(`[trials] ${expired} expired, ${reminded} reminder(s) sent`);
}
