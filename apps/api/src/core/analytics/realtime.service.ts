import { AppContext } from "../../lib/context.js";
import {
  REALTIME_SERIES_MINUTES,
  REALTIME_WINDOW_MINUTES,
  currentVisitorsQuery,
  realtimeFeedQuery,
  realtimeSeriesQuery,
  realtimeTopPagesQuery,
  realtimeTotalsQuery,
  realtimeVisitorsQuery,
  visitorActivityQuery,
} from "../../db/clickhouse/realtime.js";

const pad = (n: number) => String(n).padStart(2, "0");

/** Minute-resolution label matching the ClickHouse formatDateTime output. */
const minuteLabel = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
  `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;

export const getRealtime = async (
  { clickhouse }: AppContext,
  websiteId: string,
) => {
  const [visitors, series, topPages] = await Promise.all([
    currentVisitorsQuery(clickhouse, websiteId),
    realtimeSeriesQuery(clickhouse, websiteId),
    realtimeTopPagesQuery(clickhouse, websiteId, 10),
  ]);

  // Zero-fill so the sparkline has a point per minute even with no traffic.
  const byMinute = new Map(series.map((r) => [r.t, Number(r.visitors)]));
  const labels: string[] = [];
  const plot: number[] = [];

  const now = new Date();
  now.setUTCSeconds(0, 0);

  for (let i = REALTIME_SERIES_MINUTES - 1; i >= 0; i--) {
    const at = new Date(now.getTime() - i * 60_000);
    const label = minuteLabel(at);
    labels.push(label);
    plot.push(byMinute.get(label) ?? 0);
  }

  return {
    current_visitors: visitors,
    labels,
    plot,
    top_pages: topPages,
  };
};

// ─── Realtime page (per-visitor) ─────────────────────────────────────────────

/** Windows the Realtime page may ask for, in minutes. */
export const REALTIME_PAGE_WINDOWS = [5, 15, 30] as const;
export const DEFAULT_REALTIME_PAGE_WINDOW = 30;

const VISITOR_LIMIT = 250;
const FEED_LIMIT = 25;
const ACTIVITY_LIMIT = 25;

/**
 * The snapshot a Realtime dashboard renders before its live stream connects:
 * window totals, one row per recent visitor, and the latest activity. A
 * visitor counts as "active now" with activity in the last
 * REALTIME_WINDOW_MINUTES; older ones in the window are idle. Both thresholds
 * are returned so the client and server never disagree about the lifecycle.
 */
export const getRealtimeVisitors = async (
  { clickhouse }: AppContext,
  websiteId: string,
  windowMinutes: number,
) => {
  const [totals, visitors, feed] = await Promise.all([
    realtimeTotalsQuery(clickhouse, websiteId, windowMinutes),
    realtimeVisitorsQuery(clickhouse, websiteId, windowMinutes, VISITOR_LIMIT),
    realtimeFeedQuery(clickhouse, websiteId, windowMinutes, FEED_LIMIT),
  ]);

  return {
    window_minutes: windowMinutes,
    active_minutes: REALTIME_WINDOW_MINUTES,
    active_visitors: totals.active_visitors,
    window_visitors: totals.window_visitors,
    pageviews: totals.pageviews,
    events: totals.events,
    countries: totals.countries,
    visitors,
    recent_activity: feed,
  };
};

/** One visitor's recent trail, for the details panel. */
export const getVisitorActivity = (
  { clickhouse }: AppContext,
  websiteId: string,
  visitorId: string,
  windowMinutes: number,
) =>
  visitorActivityQuery(
    clickhouse,
    websiteId,
    visitorId,
    windowMinutes,
    ACTIVITY_LIMIT,
  );
