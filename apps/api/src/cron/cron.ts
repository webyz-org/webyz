import type { FastifyInstance } from "fastify";

import { redis } from "../lib/redis.js";
import { BILLING_ENABLED, BOT_CLUSTER_FILTER, NODE_ENV } from "../config/env.js";
import { syncUsageJob } from "./sync-usage.job.js";
import { chargeOverageJob } from "./charge-overage.job.js";
import { applyPlanChangesJob } from "./apply-plan-changes.job.js";
import { enforceLimitsJob } from "./enforce-limits.job.js";
import { updateGeoJob } from "./update-geo.job.js";
import { updateBotListsJob } from "./update-bot-lists.job.js";
import { detectScriptedTrafficJob } from "./detect-scripted-traffic.job.js";
import { purgeTokensJob } from "./purge-tokens.job.js";
import { trialsJob } from "./trials.job.js";
import { emailReportsJob } from "./email-reports.job.js";
import { trafficAlertsJob } from "./traffic-alerts.job.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type Job = {
  name: string;
  everyMs: number;
  /** Delay before the first run, so boot is not a thundering herd. */
  delayMs: number;
  /**
   * Resolves "skipped" when the job found nothing to do because of missing
   * configuration. The lock is released in that case, so a setting added
   * later takes effect at the next restart instead of after the whole
   * interval: the weekly geo job used to hold its lock for six days after
   * running once without MAXMIND_LICENSE_KEY.
   */
  run: () => Promise<void | "skipped">;
  enabled: boolean;
};

/**
 * These jobs were defined but nothing ever scheduled them, so usage was never
 * synced, quotas were never enforced and overage was never reported.
 *
 * Scheduling is interval based rather than crontab based to avoid another
 * dependency. Every run takes a short Redis lock, so running several API
 * instances does not charge the same overage twice.
 */
const jobs = (): Job[] => [
  {
    name: "sync-usage",
    everyMs: HOUR,
    delayMs: 30_000,
    run: syncUsageJob,
    enabled: true,
  },
  {
    name: "enforce-limits",
    everyMs: HOUR,
    delayMs: MINUTE,
    run: enforceLimitsJob,
    enabled: true,
  },
  {
    // Hourly, a few minutes after usage sync so it sees closed periods with
    // their final figures. Pointless, and noisy, without a provider.
    name: "charge-overage",
    everyMs: HOUR,
    delayMs: 5 * MINUTE,
    run: chargeOverageJob,
    enabled: BILLING_ENABLED,
  },
  {
    // Scheduled downgrades are held locally, so something local has to apply
    // them. Hourly is close enough to a period boundary nobody watches.
    name: "apply-plan-changes",
    everyMs: HOUR,
    delayMs: 7 * MINUTE,
    run: applyPlanChangesJob,
    enabled: BILLING_ENABLED,
  },
  {
    // Trial reminders and expiry. Cheap, so hourly keeps "days remaining" honest.
    name: "trials",
    everyMs: HOUR,
    delayMs: 90_000,
    run: trialsJob,
    enabled: true,
  },
  {
    name: "purge-tokens",
    everyMs: 6 * HOUR,
    delayMs: 3 * MINUTE,
    run: purgeTokensJob,
    enabled: true,
  },
  {
    name: "update-geo",
    everyMs: 7 * DAY,
    delayMs: 5 * MINUTE,
    run: updateGeoJob,
    enabled: true,
  },
  {
    // Data-centre ranges, the Private Relay carve-out and the referrer spam
    // domains. The upstream lists are rebuilt regularly; daily keeps new
    // cloud ranges out within a day. Until the first run the image's seed
    // copies serve (core/bots/list-files.ts).
    name: "update-bot-lists",
    everyMs: DAY,
    delayMs: MINUTE,
    run: updateBotListsJob,
    enabled: true,
  },
  {
    // Behavioural bot detection over the last hour's sessions; flags live 24
    // hours in Redis, so five minutes is often enough and cheap enough.
    name: "detect-scripted-traffic",
    everyMs: 5 * MINUTE,
    delayMs: 3 * MINUTE,
    run: detectScriptedTrafficJob,
    enabled: BOT_CLUSTER_FILTER,
  },
  {
    // Weekly and monthly summary emails become due at 09:00 in each site's
    // timezone; hourly is granular enough, and lastPeriodEnd makes a re-run
    // harmless. The console transport logs the mail when no provider is set.
    name: "email-reports",
    everyMs: HOUR,
    delayMs: 4 * MINUTE,
    run: emailReportsJob,
    enabled: true,
  },
  {
    // Live visitor count against each site's threshold, with a 12 hour
    // cooldown per site in the service.
    name: "traffic-alerts",
    everyMs: 5 * MINUTE,
    delayMs: 2 * MINUTE,
    run: trafficAlertsJob,
    enabled: true,
  },
];

/** Only one instance may run a given job in a given window. */
const withLock = async (name: string, ttlSeconds: number, fn: () => Promise<void | "skipped">) => {
  const key = `cron:lock:${name}`;
  const acquired = await redis
    .set(key, String(process.pid), "EX", ttlSeconds, "NX")
    .catch(() => null);

  if (!acquired) return;

  // The lock is kept for its full TTL after a run: it doubles as the "already
  // ran this window" marker, so a restart cannot immediately re-run the job.
  // A job that skipped did not run, so the window stays free.
  const result = await fn();
  if (result === "skipped") await redis.del(key).catch(() => null);
};

export const registerCron = (app: FastifyInstance) => {
  if (process.env.ENABLE_CRON === "false" || NODE_ENV === "test") {
    app.log.info("cron disabled");
    return;
  }

  const timers: NodeJS.Timeout[] = [];

  for (const job of jobs()) {
    if (!job.enabled) {
      app.log.info(`cron: ${job.name} disabled`);
      continue;
    }

    const tick = async () => {
      // Lock slightly shorter than the interval so the next window is free.
      const ttl = Math.max(60, Math.floor((job.everyMs / 1000) * 0.9));
      try {
        await withLock(job.name, ttl, job.run);
      } catch (err) {
        app.log.error({ err, job: job.name }, "cron job failed");
      }
    };

    const startTimer = setTimeout(() => {
      void tick();
      const interval = setInterval(() => void tick(), job.everyMs);
      timers.push(interval);
    }, job.delayMs);

    timers.push(startTimer);
    app.log.info(`cron: ${job.name} every ${job.everyMs / MINUTE}m`);
  }

  app.addHook("onClose", async () => {
    timers.forEach((t) => clearTimeout(t));
  });
};
