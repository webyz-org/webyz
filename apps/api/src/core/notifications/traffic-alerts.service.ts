import { FRONTEND_URL } from "../../config/env.js";
import { badRequest, notFound } from "../../errors/http-errors.js";
import { currentVisitorsQuery } from "../../db/clickhouse/realtime.js";
import type { AppContext } from "../../lib/context.js";
import { sendEmail } from "../email/email.service.js";
import { trafficSpikeEmail } from "../email/templates/index.js";
import { getAccessibleWebsite, getManagedWebsite } from "../website/website.service.js";
import { normalizeRecipients } from "./recipients.js";

/**
 * Traffic spike alerts: one email when the visitors on the site right now
 * reach the threshold, then silence for a cooldown so a sustained spike is
 * one alert, not one every five minutes.
 */

export const ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000;
export const MIN_THRESHOLD = 1;
export const MAX_THRESHOLD = 1_000_000;

const select = {
  id: true,
  threshold: true,
  recipients: true,
  lastTriggeredAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const getTrafficAlert = async (ctx: AppContext, userId: string, siteId: string) => {
  await getAccessibleWebsite(ctx, userId, siteId);
  return ctx.prisma.trafficAlert.findUnique({ where: { websiteId: siteId }, select });
};

export const upsertTrafficAlert = async (
  ctx: AppContext,
  userId: string,
  siteId: string,
  input: { threshold: number; recipients: unknown },
) => {
  await getManagedWebsite(ctx, userId, siteId);
  const threshold = Number(input.threshold);
  if (!Number.isInteger(threshold) || threshold < MIN_THRESHOLD || threshold > MAX_THRESHOLD) {
    throw badRequest(`threshold must be a whole number between ${MIN_THRESHOLD} and ${MAX_THRESHOLD}`);
  }
  const recipients = normalizeRecipients(input.recipients);
  return ctx.prisma.trafficAlert.upsert({
    where: { websiteId: siteId },
    create: { websiteId: siteId, threshold, recipients },
    update: { threshold, recipients },
    select,
  });
};

export const deleteTrafficAlert = async (ctx: AppContext, userId: string, siteId: string) => {
  await getManagedWebsite(ctx, userId, siteId);
  const { count } = await ctx.prisma.trafficAlert.deleteMany({ where: { websiteId: siteId } });
  if (!count) throw notFound("Alert not found");
  return { deleted: true };
};

export type RunTrafficAlertsResult = {
  alerts: number;
  triggered: number;
  sent: number;
  failed: number;
};

/**
 * The five-minute job. `scope.websiteIds` restricts the run; database tests
 * MUST pass it so they never alert every site in the dev database.
 */
export const runTrafficAlerts = async (
  ctx: AppContext,
  now: Date = new Date(),
  scope?: { websiteIds?: string[] },
): Promise<RunTrafficAlertsResult> => {
  const alerts = await ctx.prisma.trafficAlert.findMany({
    where: scope?.websiteIds ? { websiteId: { in: scope.websiteIds } } : undefined,
    include: { website: { select: { id: true, domain: true } } },
  });

  const result: RunTrafficAlertsResult = { alerts: alerts.length, triggered: 0, sent: 0, failed: 0 };

  for (const alert of alerts) {
    try {
      // Cooldown first: no ClickHouse query for a site that cannot fire anyway.
      if (alert.lastTriggeredAt && now.getTime() - alert.lastTriggeredAt.getTime() < ALERT_COOLDOWN_MS) continue;

      const visitors = Number(await currentVisitorsQuery(ctx.clickhouse, alert.websiteId));
      if (visitors < alert.threshold) continue;

      result.triggered += 1;
      const domain = alert.website.domain;
      const message = {
        domain,
        visitors,
        threshold: alert.threshold,
        realtimeUrl: `${FRONTEND_URL}/sites/${encodeURIComponent(domain)}/realtime`,
        manageUrl: `${FRONTEND_URL}/sites/${encodeURIComponent(domain)}/settings?section=notifications`,
      };
      for (const to of alert.recipients) {
        if (await sendEmail(trafficSpikeEmail(to, message))) result.sent += 1;
      }

      await ctx.prisma.trafficAlert.update({ where: { id: alert.id }, data: { lastTriggeredAt: now } });
    } catch (err) {
      result.failed += 1;
      console.error(`[traffic-alerts] ${alert.website.domain} failed:`, err instanceof Error ? err.message : err);
    }
  }

  return result;
};
