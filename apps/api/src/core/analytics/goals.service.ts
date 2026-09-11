import { AppContext } from "../../lib/context.js";
import { AnalyticsFilters } from "../../db/clickhouse/filters.js";
import {
  customEventNamesQuery,
  customEventPropertyKeysQuery,
  customEventPropertyValuesQuery,
  goalMatchesQuery,
  goalTimeseriesQuery,
  totalVisitorsQuery,
} from "../../db/clickhouse/goals.js";
import { BUCKET_FN, Interval } from "../../db/clickhouse/timeseries.js";
import { bucketLabels } from "./main-graph.service.js";
import { getBreakdown } from "./breakdown.service.js";
import { calculatePercentage } from "./helpers.js";
import { badRequest, notFound } from "../../errors/http-errors.js";

export type GoalRecord = {
  id: string;
  name: string;
  eventName: string | null;
  pagePath: string | null;
};

export const listGoals = async ({ prisma }: AppContext, websiteId: string) => {
  return prisma.goal.findMany({
    where: { websiteId },
    orderBy: { createdAt: "asc" },
  });
};

export const createGoal = async (
  { prisma }: AppContext,
  websiteId: string,
  input: { name: string; eventName?: string; pagePath?: string },
) => {
  const hasEvent = Boolean(input.eventName?.trim());
  const hasPage = Boolean(input.pagePath?.trim());

  if (hasEvent === hasPage) {
    throw badRequest(
      "A goal must set exactly one of eventName or pagePath, not both and not neither",
    );
  }

  return prisma.goal.create({
    data: {
      websiteId,
      name: input.name.trim(),
      eventName: hasEvent ? input.eventName!.trim() : null,
      pagePath: hasPage ? input.pagePath!.trim() : null,
    },
  });
};

export const deleteGoal = async (
  { prisma }: AppContext,
  websiteId: string,
  goalId: string,
) => {
  const goal = await prisma.goal.findFirst({
    where: { id: goalId, websiteId },
  });
  if (!goal) throw notFound("Goal not found");

  await prisma.goal.delete({ where: { id: goalId } });
};

/** Conversions per configured goal, with conversion rate over all visitors. */
export const getConversions = async (
  ctx: AppContext,
  input: {
    websiteId: string;
    from: number;
    to: number;
    filters?: AnalyticsFilters;
  },
) => {
  const goals = await listGoals(ctx, input.websiteId);

  if (!goals.length) {
    return { results: [], meta: { total_visitors: 0 } };
  }

  const eventNames = goals
    .map((g) => g.eventName)
    .filter((n): n is string => Boolean(n));
  const pagePaths = goals
    .map((g) => g.pagePath)
    .filter((p): p is string => Boolean(p));

  const [matches, totalVisitors] = await Promise.all([
    goalMatchesQuery(ctx.clickhouse, {
      websiteId: input.websiteId,
      from: input.from,
      to: input.to,
      eventNames,
      pagePaths,
      filters: input.filters,
    }),
    totalVisitorsQuery(ctx.clickhouse, {
      websiteId: input.websiteId,
      from: input.from,
      to: input.to,
      filters: input.filters,
    }),
  ]);

  const byEvent = new Map<string, { visitors: number; completions: number }>();
  const byPage = new Map<string, { visitors: number; completions: number }>();

  for (const row of matches) {
    const target = row.event_type === "event" ? byEvent : byPage;
    const key = row.event_type === "event" ? row.event_name : row.url_path;
    const existing = target.get(key);
    target.set(key, {
      visitors: (existing?.visitors ?? 0) + Number(row.visitors),
      completions: (existing?.completions ?? 0) + Number(row.completions),
    });
  }

  const results = goals.map((goal) => {
    const hit = goal.eventName
      ? byEvent.get(goal.eventName)
      : byPage.get(goal.pagePath ?? "");

    const visitors = hit?.visitors ?? 0;

    return {
      id: goal.id,
      name: goal.name,
      event_name: goal.eventName,
      page_path: goal.pagePath,
      visitors,
      completions: hit?.completions ?? 0,
      conversion_rate: calculatePercentage(visitors, totalVisitors),
    };
  });

  results.sort((a, b) => b.visitors - a.visitors);

  return { results, meta: { total_visitors: totalVisitors } };
};

/** Same interval rule as the pages trend, so charts bucket consistently. */
const trendInterval = (from: number, to: number): Interval => {
  const span = to - from;
  if (span <= 60 * 60 * 48) return "hour";
  if (span <= 60 * 60 * 24 * 366) return "day";
  return "month";
};

const DETAIL_BREAKDOWN_LIMIT = 8;

/**
 * One goal's detail: totals, conversion trend, and who converts (sources,
 * devices, countries of the sessions that completed the goal). Breakdowns run
 * through the shared sessionBreakdown restriction so their dedupe and
 * percentage semantics cannot drift from the rest of the dashboard.
 */
export const getGoalDetail = async (
  ctx: AppContext,
  input: {
    websiteId: string;
    goalId: string;
    from: number;
    to: number;
    timezone: string;
  },
) => {
  const goal = await ctx.prisma.goal.findFirst({
    where: { id: input.goalId, websiteId: input.websiteId },
  });
  if (!goal) throw notFound("Goal not found");

  const interval = trendInterval(input.from, input.to);
  const labels = bucketLabels(input.from, input.to, interval, input.timezone);

  const conversion = { eventName: goal.eventName, pagePath: goal.pagePath };
  const breakdown = (dimension: "source" | "device" | "country") =>
    getBreakdown(ctx, {
      websiteId: input.websiteId,
      dimension,
      from: input.from,
      to: input.to,
      limit: DETAIL_BREAKDOWN_LIMIT,
      page: 1,
      detailed: false,
      conversion,
    });

  const [matches, totalVisitors, series, sources, devices, countries] =
    await Promise.all([
      goalMatchesQuery(ctx.clickhouse, {
        websiteId: input.websiteId,
        from: input.from,
        to: input.to,
        eventNames: goal.eventName ? [goal.eventName] : [],
        pagePaths: goal.pagePath ? [goal.pagePath] : [],
      }),
      totalVisitorsQuery(ctx.clickhouse, {
        websiteId: input.websiteId,
        from: input.from,
        to: input.to,
      }),
      goalTimeseriesQuery(ctx.clickhouse, {
        websiteId: input.websiteId,
        from: input.from,
        to: input.to,
        eventName: goal.eventName,
        pagePath: goal.pagePath,
        bucketFn: BUCKET_FN[interval],
        timezone: input.timezone,
      }),
      breakdown("source"),
      breakdown("device"),
      breakdown("country"),
    ]);

  const visitors = matches.reduce((sum, r) => sum + Number(r.visitors), 0);
  const completions = matches.reduce((sum, r) => sum + Number(r.completions), 0);

  const byBucket = new Map(series.map((r) => [r.t, Number(r.visitors)]));

  return {
    goal: {
      id: goal.id,
      name: goal.name,
      event_name: goal.eventName,
      page_path: goal.pagePath,
    },
    totals: {
      visitors,
      completions,
      total_visitors: totalVisitors,
      conversion_rate: calculatePercentage(visitors, totalVisitors),
    },
    trend: {
      labels,
      plot: labels.map((l) => byBucket.get(l) ?? 0),
      interval,
    },
    sources: sources.results,
    devices: devices.results,
    countries: countries.results,
  };
};

/** Custom event names actually seen, so the UI can suggest goals. */
export const getCustomEvents = async (
  { clickhouse }: AppContext,
  input: {
    websiteId: string;
    from: number;
    to: number;
    limit: number;
    filters?: AnalyticsFilters;
  },
) => {
  const rows = await customEventNamesQuery(clickhouse, input);
  const total = rows.reduce((sum, r) => sum + Number(r.visitors), 0);

  return {
    results: rows.map((r) => ({
      name: r.name,
      visitors: Number(r.visitors),
      completions: Number(r.completions),
      percentage: calculatePercentage(Number(r.visitors), total),
    })),
  };
};

/**
 * Properties of one custom event: the keys it carries, or the values of one
 * key. Percentages are over the visitors who fired the event (keys) or who
 * sent that key (values), so they read as "share of signups by plan".
 */
export const getCustomEventProperties = async (
  { clickhouse }: AppContext,
  input: {
    websiteId: string;
    from: number;
    to: number;
    eventName: string;
    key?: string;
    limit: number;
    filters?: AnalyticsFilters;
  },
) => {
  const rows = input.key
    ? await customEventPropertyValuesQuery(clickhouse, { ...input, key: input.key })
    : await customEventPropertyKeysQuery(clickhouse, input);

  const totalVisitors = rows[0]?.total_visitors ?? 0;

  return {
    results: rows.map((row) => ({
      name: row.name,
      visitors: row.visitors,
      events: row.events,
      percentage: calculatePercentage(row.visitors, totalVisitors),
    })),
    meta: { event: input.eventName, key: input.key ?? null, total_visitors: totalVisitors },
  };
};
