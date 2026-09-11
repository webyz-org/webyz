import { AppContext } from "../../lib/context.js";
import {
  PagesSortKey,
  pageDetailStatsQuery,
  pageEventsQuery,
  pagesListQuery,
  pagesSparklineQuery,
  pagesSummaryQuery,
} from "../../db/clickhouse/pages.js";
import { BUCKET_FN, Interval } from "../../db/clickhouse/timeseries.js";
import { bucketLabels } from "./main-graph.service.js";
import { getBreakdown } from "./breakdown.service.js";

/**
 * Pages analytics. Metric definitions live next to the SQL in
 * db/clickhouse/pages.ts; this layer orchestrates the queries, zero-fills the
 * trend buckets and shapes the response. The comparison window is always the
 * immediately preceding window of the same length, exactly like top-stats.
 */

const DETAIL_BREAKDOWN_LIMIT = 8;
const DETAIL_EVENTS_LIMIT = 10;

/**
 * Trend granularity for the window: hourly up to two days, daily up to a year,
 * monthly beyond. Mirrors the dashboard's intervalForPeriod so a page's trend
 * and the main graph bucket the same way for the same period.
 */
const trendInterval = (from: number, to: number): Interval => {
  const span = to - from;
  if (span <= 60 * 60 * 48) return "hour";
  if (span <= 60 * 60 * 24 * 366) return "day";
  return "month";
};

export type PagesListInput = {
  websiteId: string;
  timezone: string;
  from: number;
  to: number;
  search?: string;
  sort: PagesSortKey;
  order: "asc" | "desc";
  limit: number;
  page: number;
};

export type PageEntry = {
  path: string;
  title: string;
  views: number;
  sessions: number;
  visitors: number;
  bounce_rate: number;
  avg_duration: number;
  prev_views: number;
  change: number;
  spark: number[];
};

export type PagesResult = {
  summary: {
    pages: number;
    pageviews: number;
    sessions: number;
    bounce_rate: number;
    avg_duration: number;
    top_page: string | null;
  };
  trend_labels: string[];
  interval: Interval;
  results: PageEntry[];
  meta: {
    page: number;
    limit: number;
    total_items: number;
    has_more: boolean;
  };
};

export const getPages = async (
  { clickhouse }: AppContext,
  input: PagesListInput,
): Promise<PagesResult> => {
  const offset = (input.page - 1) * input.limit;
  const span = input.to - input.from;
  const compareFrom = input.from - span;
  const compareTo = input.from;

  const [summary, rows] = await Promise.all([
    pagesSummaryQuery(clickhouse, {
      websiteId: input.websiteId,
      from: input.from,
      to: input.to,
    }),
    pagesListQuery(clickhouse, {
      websiteId: input.websiteId,
      from: input.from,
      to: input.to,
      compareFrom,
      compareTo,
      search: input.search,
      sort: input.sort,
      order: input.order,
      pagination: { limit: input.limit, offset },
    }),
  ]);

  const interval = trendInterval(input.from, input.to);
  const labels = bucketLabels(input.from, input.to, interval, input.timezone);

  // One sparkline query for the whole result page, zero-filled per bucket.
  const sparkRows = await pagesSparklineQuery(clickhouse, {
    websiteId: input.websiteId,
    from: input.from,
    to: input.to,
    paths: rows.map((r) => r.path),
    bucketFn: BUCKET_FN[interval],
    timezone: input.timezone,
  });

  const sparkByPath = new Map<string, Map<string, number>>();
  for (const row of sparkRows) {
    let byBucket = sparkByPath.get(row.path);
    if (!byBucket) {
      byBucket = new Map();
      sparkByPath.set(row.path, byBucket);
    }
    byBucket.set(row.t, Number(row.views));
  }

  const totalItems = rows[0]?.total_pages ?? 0;

  return {
    summary: {
      pages: summary?.pages ?? 0,
      pageviews: summary?.pageviews ?? 0,
      sessions: summary?.sessions ?? 0,
      bounce_rate: summary?.bounce_rate ?? 0,
      avg_duration: summary?.avg_duration ?? 0,
      top_page: summary?.top_page || null,
    },
    trend_labels: labels,
    interval,
    results: rows.map((row) => {
      const byBucket = sparkByPath.get(row.path);
      return {
        path: row.path,
        title: row.title,
        views: row.views,
        sessions: row.sessions,
        visitors: row.visitors,
        bounce_rate: row.bounce_rate,
        avg_duration: row.avg_duration,
        prev_views: row.prev_views,
        change: row.change,
        spark: labels.map((l) => byBucket?.get(l) ?? 0),
      };
    }),
    meta: {
      page: input.page,
      limit: input.limit,
      total_items: totalItems,
      has_more: offset + rows.length < totalItems,
    },
  };
};

export type PageDetailResult = {
  path: string;
  title: string;
  stats: {
    views: number;
    prev_views: number;
    change: number;
    sessions: number;
    visitors: number;
    bounce_rate: number;
    avg_duration: number;
    entry_sessions: number;
    exit_sessions: number;
    /** Sessions that ended on this page, over sessions that viewed it. */
    exit_rate: number;
  };
  trend: { labels: string[]; plot: number[]; interval: Interval };
  sources: Array<{ name: string; visitors: number; percentage: number }>;
  devices: Array<{ name: string; visitors: number; percentage: number }>;
  countries: Array<{ name: string; visitors: number; percentage: number }>;
  events: Array<{ name: string; total: number; visitors: number }>;
};

export const getPageDetail = async (
  ctx: AppContext,
  input: {
    websiteId: string;
    timezone: string;
    path: string;
    from: number;
    to: number;
  },
): Promise<PageDetailResult> => {
  const { clickhouse } = ctx;
  const span = input.to - input.from;
  const compareFrom = input.from - span;
  const compareTo = input.from;

  const interval = trendInterval(input.from, input.to);
  const labels = bucketLabels(input.from, input.to, interval, input.timezone);

  const breakdown = (dimension: "source" | "device" | "country") =>
    getBreakdown(ctx, {
      websiteId: input.websiteId,
      dimension,
      from: input.from,
      to: input.to,
      limit: DETAIL_BREAKDOWN_LIMIT,
      page: 1,
      detailed: false,
      pagePath: input.path,
    });

  const [stats, sparkRows, sources, devices, countries, events] =
    await Promise.all([
      pageDetailStatsQuery(clickhouse, {
        websiteId: input.websiteId,
        path: input.path,
        from: input.from,
        to: input.to,
        compareFrom,
        compareTo,
      }),
      pagesSparklineQuery(clickhouse, {
        websiteId: input.websiteId,
        from: input.from,
        to: input.to,
        paths: [input.path],
        bucketFn: BUCKET_FN[interval],
        timezone: input.timezone,
      }),
      breakdown("source"),
      breakdown("device"),
      breakdown("country"),
      pageEventsQuery(clickhouse, {
        websiteId: input.websiteId,
        path: input.path,
        from: input.from,
        to: input.to,
        limit: DETAIL_EVENTS_LIMIT,
      }),
    ]);

  const byBucket = new Map(sparkRows.map((r) => [r.t, Number(r.views)]));

  const views = stats?.views ?? 0;
  const prevViews = stats?.prev_views ?? 0;
  const sessions = stats?.sessions ?? 0;
  const exitSessions = stats?.exit_sessions ?? 0;

  return {
    path: input.path,
    title: stats?.title ?? "",
    stats: {
      views,
      prev_views: prevViews,
      change:
        prevViews > 0
          ? Math.round(((views - prevViews) / prevViews) * 1000) / 10
          : 0,
      sessions,
      visitors: stats?.visitors ?? 0,
      bounce_rate: stats?.bounce_rate ?? 0,
      avg_duration: stats?.avg_duration ?? 0,
      entry_sessions: stats?.entry_sessions ?? 0,
      exit_sessions: exitSessions,
      exit_rate:
        sessions > 0 ? Math.round((exitSessions / sessions) * 1000) / 10 : 0,
    },
    trend: {
      labels,
      plot: labels.map((l) => byBucket.get(l) ?? 0),
      interval,
    },
    sources: sources.results,
    devices: devices.results,
    countries: countries.results,
    events,
  };
};
