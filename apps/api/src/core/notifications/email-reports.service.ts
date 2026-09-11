import { FRONTEND_URL } from "../../config/env.js";
import { notFound } from "../../errors/http-errors.js";
import { retentionFloor } from "../../http/normalize/period.js";
import type { AppContext } from "../../lib/context.js";
import type { ReportFrequency } from "../../generated/prisma/client.js";
import { getBreakdown } from "../analytics/breakdown.service.js";
import { getConversions } from "../analytics/goals.service.js";
import { getTopStats } from "../analytics/top-stats.service.js";
import { getEntitlements, getLimit } from "../billing/entitlements/entitlement.service.js";
import { sendEmail } from "../email/email.service.js";
import {
  formatReportStatValue,
  periodicReportEmail,
  type PeriodicReportData,
  type ReportStat,
} from "../email/templates/index.js";
import { getAccessibleWebsite, getManagedWebsite } from "../website/website.service.js";
import { normalizeRecipients } from "./recipients.js";
import { alreadyReported, completedReportPeriod, localDateString, type ReportPeriod } from "./report-periods.js";

/**
 * Scheduled summary emails. A site has at most one report per frequency; each
 * run covers the most recent completed period in the site's timezone (see
 * report-periods.ts) and records its exclusive end in `lastPeriodEnd`, so a
 * restart, a second instance or a long outage can never send a period twice.
 * An outage longer than a period skips the missed ones: the next run reports
 * the latest complete period only, which is what a reader wants on Monday.
 */

export const REPORT_FREQUENCIES = ["WEEKLY", "MONTHLY"] as const;

const REPORT_METRICS = ["visitors", "visits", "pageviews", "bounce_rate", "visit_duration"];
const TOP_N = 5;

export const listEmailReports = async (ctx: AppContext, userId: string, siteId: string) => {
  await getAccessibleWebsite(ctx, userId, siteId);
  return ctx.prisma.emailReport.findMany({
    where: { websiteId: siteId },
    orderBy: { frequency: "asc" },
    select: { id: true, frequency: true, recipients: true, lastPeriodEnd: true, createdAt: true, updatedAt: true },
  });
};

export const upsertEmailReport = async (
  ctx: AppContext,
  userId: string,
  siteId: string,
  frequency: ReportFrequency,
  recipientsInput: unknown,
) => {
  await getManagedWebsite(ctx, userId, siteId);
  const recipients = normalizeRecipients(recipientsInput);
  return ctx.prisma.emailReport.upsert({
    where: { websiteId_frequency: { websiteId: siteId, frequency } },
    create: { websiteId: siteId, frequency, recipients },
    update: { recipients },
    select: { id: true, frequency: true, recipients: true, lastPeriodEnd: true, createdAt: true, updatedAt: true },
  });
};

export const deleteEmailReport = async (
  ctx: AppContext,
  userId: string,
  siteId: string,
  frequency: ReportFrequency,
) => {
  await getManagedWebsite(ctx, userId, siteId);
  const { count } = await ctx.prisma.emailReport.deleteMany({ where: { websiteId: siteId, frequency } });
  if (!count) throw notFound("Report not found");
  return { deleted: true };
};

type ReportSite = { id: string; domain: string; timezone: string; userId: string };

/**
 * Everything a report email shows, for one site and one period. The window is
 * cut at the owner's retention floor like every dashboard read, so a report
 * never shows data the plan does not retain.
 */
export const buildReportData = async (
  ctx: AppContext,
  site: ReportSite,
  period: ReportPeriod,
  now: Date,
): Promise<PeriodicReportData> => {
  const { entitlements } = await getEntitlements(ctx, site.userId);
  const floor = retentionFloor({
    retentionDays: getLimit(entitlements, "retention_days"),
    timezone: site.timezone,
    now: now.getTime(),
  });
  const from = Math.max(period.from, floor);
  const to = Math.max(period.to, from);
  const compareFrom = Math.max(period.compareFrom, floor);
  const compareTo = Math.max(period.compareTo, compareFrom);

  const [topStats, pages, sources, conversions] = await Promise.all([
    getTopStats(ctx, { websiteId: site.id, from, to, compareFrom, compareTo }),
    getBreakdown(ctx, { websiteId: site.id, dimension: "page", from, to, limit: TOP_N, page: 1, detailed: false }),
    getBreakdown(ctx, { websiteId: site.id, dimension: "source", from, to, limit: TOP_N, page: 1, detailed: false }),
    getConversions(ctx, { websiteId: site.id, from, to }),
  ]);

  const stats: ReportStat[] = (topStats ?? [])
    .filter((s) => REPORT_METRICS.includes(s.graph_metric))
    .map((s) => ({ name: s.name, value: formatReportStatValue(s.graph_metric, s.value), change: s.change }));

  const kind = period.frequency === "WEEKLY" ? "Weekly" : "Monthly";
  // Custom periods are inclusive local dates, so the exclusive end steps back
  // one second before it is turned into a date.
  const fromDate = localDateString(from, site.timezone);
  const toDate = localDateString(to - 1, site.timezone);

  return {
    kind,
    domain: site.domain,
    periodLabel: period.label,
    stats,
    topPages: pages.results.map((r) => ({ name: r.name, visitors: r.visitors })),
    topSources: sources.results.map((r) => ({ name: r.name, visitors: r.visitors })),
    goals: conversions.results
      .filter((g) => g.completions > 0)
      .map((g) => ({ name: g.name, completions: g.completions, conversion_rate: g.conversion_rate })),
    dashboardUrl: `${FRONTEND_URL}/sites/${encodeURIComponent(site.domain)}?period=custom&from=${fromDate}&to=${toDate}`,
    manageUrl: `${FRONTEND_URL}/sites/${encodeURIComponent(site.domain)}/settings?section=notifications`,
  };
};

export type RunEmailReportsResult = {
  reports: number;
  sent: number;
  /** Not due yet, or already covered by lastPeriodEnd. */
  skipped: number;
  failed: number;
};

/**
 * The hourly job. `scope.websiteIds` restricts the run; database tests MUST
 * pass it so they never mail every site in the dev database.
 */
export const runEmailReports = async (
  ctx: AppContext,
  now: Date = new Date(),
  scope?: { websiteIds?: string[] },
): Promise<RunEmailReportsResult> => {
  const reports = await ctx.prisma.emailReport.findMany({
    where: scope?.websiteIds ? { websiteId: { in: scope.websiteIds } } : undefined,
    include: { website: { select: { id: true, domain: true, timezone: true, userId: true } } },
  });

  const result: RunEmailReportsResult = { reports: reports.length, sent: 0, skipped: 0, failed: 0 };

  for (const report of reports) {
    try {
      const period = completedReportPeriod(report.frequency, now, report.website.timezone);
      if (!period.due || alreadyReported(report.lastPeriodEnd, period.to)) {
        result.skipped += 1;
        continue;
      }

      const data = await buildReportData(ctx, report.website, period, now);
      let delivered = 0;
      for (const to of report.recipients) {
        if (await sendEmail(periodicReportEmail(to, data))) delivered += 1;
      }

      // Recorded even when a transport failed for some recipients: the
      // provider is the retry boundary, and re-sending the whole period to
      // everyone would double up the ones that went through.
      await ctx.prisma.emailReport.update({
        where: { id: report.id },
        data: { lastPeriodEnd: new Date(period.to * 1000) },
      });
      result.sent += delivered;
    } catch (err) {
      result.failed += 1;
      console.error(`[email-reports] ${report.website.domain} ${report.frequency} failed:`, err instanceof Error ? err.message : err);
    }
  }

  return result;
};

/**
 * Send the most recent completed period to one address now, regardless of
 * the send hour and without touching lastPeriodEnd. For checking what the
 * report looks like.
 */
export const sendTestReport = async (
  ctx: AppContext,
  userId: string,
  siteId: string,
  frequency: ReportFrequency,
  to: string,
  now: Date = new Date(),
) => {
  const site = await getAccessibleWebsite(ctx, userId, siteId);
  const period = completedReportPeriod(frequency, now, site.timezone);
  const data = await buildReportData(ctx, site, period, now);
  const sent = await sendEmail(periodicReportEmail(to, data));
  return { sent, to, period: { from: period.from, to: period.to, label: period.label } };
};
