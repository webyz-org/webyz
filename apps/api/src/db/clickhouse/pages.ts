import { ClickHouseClient } from "@clickhouse/client";

import { Pagination } from "../../core/types/pagination.js";
import { importedWhere, type ImportedRead } from "./imported.js";

/**
 * Pages analytics queries.
 *
 * Definitions are shared with the existing breakdowns so the Pages page can
 * never disagree with the Overview:
 *
 * - A page is a stored `url_path`. Query strings (utm_*, gclid, ...) were
 *   already split off at ingest (ingest/helpers/url.ts), so `/pricing?utm_...`
 *   and `/pricing` are one page by construction.
 * - Views: pageview events for the path in the window.
 * - Sessions: sessions that viewed the path at least once.
 * - Bounce rate (same as db/clickhouse/breakdown.ts pageBreakdown): sessions
 *   that ENTERED on this path and saw exactly one page, over sessions that
 *   viewed the path. A single-page session bounces its entry page only.
 * - Duration: average duration of the sessions that viewed the path, from the
 *   session rows the tracker already maintains - no second duration model.
 * - Title: the most recent non-empty document title captured for the path.
 * - Scroll depth (Plausible's definition): over the visits that sent an
 *   engagement report for the path, the average of each visit's deepest
 *   scroll on it, in percent.
 * - Time on page (Plausible's definition): engaged seconds on the path over
 *   the visits that reported engagement for it.
 * - Imported history (core/imports/imported-plan.ts, `pages` family) adds
 *   views, visits, visitors and the engagement parts, never bounces or visit
 *   seconds, so bounce rate and duration stay tracked-only for imported days,
 *   as in Plausible.
 *
 * `sessions` is a ReplacingMergeTree, so session rows are deduplicated with
 * `argMax(col, updated_at) ... GROUP BY session_id` exactly like every other
 * query in this directory.
 */

export type PagesSortKey =
  | "views"
  | "sessions"
  | "visitors"
  | "bounce_rate"
  | "duration"
  | "scroll_depth"
  | "time_on_page"
  | "trend";

/** Sort keys are an allowlist mapped to SELECT aliases, never caller input. */
const SORT_EXPR: Record<PagesSortKey, string> = {
  views: "views",
  sessions: "sessions",
  visitors: "visitors",
  bounce_rate: "bounce_rate",
  duration: "avg_duration",
  scroll_depth: "scroll_depth",
  time_on_page: "time_on_page",
  trend: "change",
};

export type PageListRow = {
  path: string;
  title: string;
  views: number;
  sessions: number;
  visitors: number;
  bounce_rate: number;
  avg_duration: number;
  /** Percent, null when no visit reported engagement for the page. */
  scroll_depth: number | null;
  /** Seconds, null when no visit reported engagement for the page. */
  time_on_page: number | null;
  prev_views: number;
  change: number;
  total_pages: number;
};

/** One engagement row per visit and page in the window: deepest scroll, engaged ms. */
const engagementCte = (pathClause = "") => `
    eng AS (
      SELECT url_path, session_id, max(scroll_depth) AS sd, sum(engaged_ms) AS ms
      FROM engagements
      WHERE website_id = {websiteId:String}
        AND timestamp >= fromUnixTimestamp({from:UInt32})
        AND timestamp <  fromUnixTimestamp({to:UInt32})${pathClause}
      GROUP BY url_path, session_id
    )`;

/** Scroll depth and time on page from summed parts, null without engagement. */
const ENGAGEMENT_SELECT = `
      if(scroll_visits = 0, NULL, round(scroll_total / scroll_visits)) AS scroll_depth,
      if(time_visits = 0, NULL, round(time_total / time_visits)) AS time_on_page`;

export const pagesListQuery = async (
  clickhouse: ClickHouseClient,
  input: {
    websiteId: string;
    from: number;
    to: number;
    compareFrom: number;
    compareTo: number;
    search?: string;
    sort: PagesSortKey;
    order: "asc" | "desc";
    pagination: Pagination;
    /** Planned imported reads for the window and the comparison window. */
    imported?: { current: ImportedRead | null; comparison: ImportedRead | null };
  },
): Promise<PageListRow[]> => {
  const sortExpr = SORT_EXPR[input.sort] ?? SORT_EXPR.views;
  const direction = input.order === "asc" ? "ASC" : "DESC";

  const search = input.search?.trim() ?? "";
  const searchClause = search
    ? `AND (positionCaseInsensitive(path, {search:String}) > 0
         OR positionCaseInsensitive(title, {search:String}) > 0)`
    : "";

  const query_params: Record<string, unknown> = {
    websiteId: input.websiteId,
    from: input.from,
    to: input.to,
    compareFrom: input.compareFrom,
    compareTo: input.compareTo,
    search,
    limit: input.pagination.limit,
    offset: input.pagination.offset,
  };

  // Every source yields the same columns; the merge sums them per path.
  // path, title, views, sessions, visitors, bounces, rate_sessions,
  // duration_sum, scroll_total, scroll_visits, time_total, time_visits, prev_views
  const importedParts: string[] = [];
  if (input.imported?.current) {
    importedParts.push(`
      SELECT page, '', sum(pageviews), sum(visits), sum(visitors), 0, 0, 0,
             sum(scroll_depth), sum(scroll_depth_visits), sum(time_on_page), sum(time_on_page_visits), 0
      FROM webyz_analytics.imported_stats
      WHERE ${importedWhere(input.imported.current, query_params, "impCur")} AND page != ''
      GROUP BY page`);
  }
  if (input.imported?.comparison) {
    importedParts.push(`
      SELECT page, '', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, sum(pageviews)
      FROM webyz_analytics.imported_stats
      WHERE ${importedWhere(input.imported.comparison, query_params, "impPrev")} AND page != ''
      GROUP BY page`);
  }

  const query = `
    WITH
    pv AS (
      SELECT url_path, page_title, session_id, user_id, timestamp
      FROM events
      WHERE website_id = {websiteId:String}
        AND event_type = 'pageview'
        AND timestamp >= fromUnixTimestamp({from:UInt32})
        AND timestamp <  fromUnixTimestamp({to:UInt32})
    ),
    sess AS (
      SELECT
        session_id,
        argMax(page_views, updated_at) AS page_views,
        argMax(events, updated_at) AS events,
        argMax(duration_seconds, updated_at) AS duration_seconds,
        argMax(entry_page, updated_at) AS entry_page
      FROM sessions
      WHERE website_id = {websiteId:String}
        AND start_time < fromUnixTimestamp({to:UInt32})
        AND end_time >= fromUnixTimestamp({from:UInt32})
      GROUP BY session_id
    ),${engagementCte()},
    parts AS (
      SELECT
        p.url_path AS path,
        argMaxIf(p.page_title, p.timestamp, p.page_title != '') AS title,
        toUInt64(count()) AS views,
        toUInt64(uniqExact(p.session_id)) AS sessions,
        toUInt64(uniqExact(p.user_id)) AS visitors,
        toUInt64(countIf(s.events = 1 AND s.entry_page = p.url_path)) AS bounces,
        toUInt64(uniqExact(p.session_id)) AS rate_sessions,
        toUInt64(round(ifNotFinite(avg(s.duration_seconds), 0) * uniqExact(p.session_id))) AS duration_sum,
        toUInt64(0) AS scroll_total, toUInt64(0) AS scroll_visits,
        toUInt64(0) AS time_total, toUInt64(0) AS time_visits,
        toUInt64(0) AS prev_views
      FROM pv p
      LEFT JOIN sess s USING (session_id)
      GROUP BY path
      UNION ALL
      SELECT url_path, '', 0, 0, 0, 0, 0, 0,
             toUInt64(sum(sd)), toUInt64(count()), toUInt64(round(sum(ms) / 1000)), toUInt64(count()), 0
      FROM eng
      GROUP BY url_path
      UNION ALL
      SELECT url_path, '', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, toUInt64(count())
      FROM events
      WHERE website_id = {websiteId:String}
        AND event_type = 'pageview'
        AND timestamp >= fromUnixTimestamp({compareFrom:UInt32})
        AND timestamp <  fromUnixTimestamp({compareTo:UInt32})
      GROUP BY url_path${importedParts.map((part) => `
      UNION ALL${part}`).join("")}
    ),
    merged AS (
      SELECT
        path,
        anyIf(title, title != '') AS title,
        sum(views) AS views,
        sum(sessions) AS sessions,
        sum(visitors) AS visitors,
        sum(bounces) AS bounces,
        sum(rate_sessions) AS rate_sessions,
        sum(duration_sum) AS duration_sum,
        sum(scroll_total) AS scroll_total,
        sum(scroll_visits) AS scroll_visits,
        sum(time_total) AS time_total,
        sum(time_visits) AS time_visits,
        sum(prev_views) AS prev_views
      FROM parts
      GROUP BY path
      HAVING views > 0
    )
    SELECT
      path,
      title,
      toUInt32(views) AS views,
      toUInt32(sessions) AS sessions,
      toUInt32(visitors) AS visitors,
      round(bounces / greatest(rate_sessions, 1) * 100, 2) AS bounce_rate,
      toUInt32(round(duration_sum / greatest(rate_sessions, 1))) AS avg_duration,${ENGAGEMENT_SELECT},
      toUInt32(prev_views) AS prev_views,
      round((views - prev_views) / greatest(prev_views, 1) * 100, 1) AS change,
      toUInt32(count() OVER ()) AS total_pages
    FROM merged
    WHERE 1 ${searchClause}
    ORDER BY ${sortExpr} ${direction} NULLS LAST, views DESC, sessions DESC, path ASC
    LIMIT {limit:UInt32} OFFSET {offset:UInt32}
  `;

  const result = await clickhouse.query({ query, query_params, format: "JSONEachRow" });
  return result.json<PageListRow>();
};

export type PagesSummaryRow = {
  pages: number;
  pageviews: number;
  sessions: number;
  bounce_rate: number;
  avg_duration: number;
  top_page: string;
};

/**
 * Site-wide totals for the summary strip. Sessions, bounce rate and duration
 * use the exact expressions top-stats uses over deduped session rows, so the
 * strip agrees with the Overview for the same window; pages, pageviews and
 * the top page come from pageview events so they agree with the table below.
 */
export const pagesSummaryQuery = async (
  clickhouse: ClickHouseClient,
  input: {
    websiteId: string;
    from: number;
    to: number;
    /** Imported `pages` rows (page count, top page) and site totals (the rest). */
    imported?: { pages: ImportedRead | null; totals: ImportedRead | null };
  },
): Promise<PagesSummaryRow | null> => {
  const query_params: Record<string, unknown> = {
    websiteId: input.websiteId,
    from: input.from,
    to: input.to,
  };
  const pagesRead = input.imported?.pages;
  const totalsRead = input.imported?.totals;
  const impPages = pagesRead
    ? `UNION ALL SELECT page AS p, sum(pageviews) AS v FROM webyz_analytics.imported_stats
         WHERE ${importedWhere(pagesRead, query_params, "impPages")} AND page != '' GROUP BY page`
    : "";
  const impTotals = totalsRead
    ? `SELECT sum(pageviews) AS pageviews, sum(visits) AS visits, sum(bounces) AS bounces,
              sum(visit_duration) AS duration
       FROM webyz_analytics.imported_stats WHERE ${importedWhere(totalsRead, query_params, "impTot")}`
    : "SELECT 0 AS pageviews, 0 AS visits, 0 AS bounces, 0 AS duration";

  const query = `
    WITH
    pv AS (
      SELECT url_path, session_id
      FROM events
      WHERE website_id = {websiteId:String}
        AND event_type = 'pageview'
        AND timestamp >= fromUnixTimestamp({from:UInt32})
        AND timestamp <  fromUnixTimestamp({to:UInt32})
    ),
    sess AS (
      SELECT
        session_id,
        argMax(page_views, updated_at) AS page_views,
        argMax(events, updated_at) AS events,
        argMax(duration_seconds, updated_at) AS duration_seconds
      FROM sessions
      WHERE website_id = {websiteId:String}
        AND start_time >= fromUnixTimestamp({from:UInt32})
        AND start_time <  fromUnixTimestamp({to:UInt32})
      GROUP BY session_id
    ),
    by_page AS (
      SELECT p, sum(v) AS views FROM (
        SELECT url_path AS p, toUInt64(count()) AS v FROM pv GROUP BY url_path
        ${impPages}
      ) GROUP BY p
    ),
    imp AS (${impTotals}),
    native AS (
      SELECT count() AS visits, countIf(events = 1) AS bounces, sum(duration_seconds) AS duration FROM sess
    )
    SELECT
      (SELECT toUInt32(count()) FROM by_page) AS pages,
      toUInt32((SELECT count() FROM pv) + (SELECT pageviews FROM imp)) AS pageviews,
      toUInt32((SELECT visits FROM native) + (SELECT visits FROM imp)) AS sessions,
      round(
        ((SELECT bounces FROM native) + (SELECT bounces FROM imp))
          / greatest((SELECT visits FROM native) + (SELECT visits FROM imp), 1) * 100,
        2
      ) AS bounce_rate,
      toUInt32(round(
        ((SELECT duration FROM native) + (SELECT duration FROM imp))
          / greatest((SELECT visits FROM native) + (SELECT visits FROM imp), 1)
      )) AS avg_duration,
      (SELECT any(p) FROM (SELECT p FROM by_page ORDER BY views DESC, p ASC LIMIT 1)) AS top_page
  `;

  const result = await clickhouse.query({ query, query_params, format: "JSONEachRow" });
  const rows = await result.json<PagesSummaryRow>();
  return rows[0] ?? null;
};

export type PageSparkRow = {
  path: string;
  t: string;
  views: number;
};

/**
 * Bucketed pageview counts for a set of paths, for the table sparklines. One
 * query serves the whole result page; the service zero-fills the buckets.
 * Buckets are cut in the site's timezone like every other series.
 */
export const pagesSparklineQuery = async (
  clickhouse: ClickHouseClient,
  input: {
    websiteId: string;
    from: number;
    to: number;
    paths: string[];
    bucketFn: string;
    timezone: string;
    /**
     * Imported `pages` rows, with the bucket over their `date` column (day,
     * week or month only; imported data has no hours).
     */
    imported?: { read: ImportedRead; dateBucket: string } | null;
  },
): Promise<PageSparkRow[]> => {
  if (!input.paths.length) return [];

  const query_params: Record<string, unknown> = {
    websiteId: input.websiteId,
    from: input.from,
    to: input.to,
    paths: input.paths,
    timezone: input.timezone,
  };
  const imported = input.imported
    ? `
      UNION ALL
      SELECT page, formatDateTime(toDateTime(${input.imported.dateBucket}), '%Y-%m-%d %H:%i:00'), toUInt64(sum(pageviews))
      FROM webyz_analytics.imported_stats
      WHERE ${importedWhere(input.imported.read, query_params)} AND page IN ({paths:Array(String)})
      GROUP BY page, 2`
    : "";

  const result = await clickhouse.query({
    query: `
      SELECT path, t, toUInt32(sum(views)) AS views FROM (
        SELECT
          url_path AS path,
          formatDateTime(
            ${input.bucketFn}(toTimeZone(timestamp, {timezone:String})),
            '%Y-%m-%d %H:%i:00'
          ) AS t,
          toUInt64(count()) AS views
        FROM events
        WHERE website_id = {websiteId:String}
          AND event_type = 'pageview'
          AND timestamp >= fromUnixTimestamp({from:UInt32})
          AND timestamp <  fromUnixTimestamp({to:UInt32})
          AND url_path IN ({paths:Array(String)})
        GROUP BY path, t${imported}
      )
      GROUP BY path, t
      ORDER BY path, t
    `,
    query_params,
    format: "JSONEachRow",
  });

  return result.json<PageSparkRow>();
};

export type PageDetailStatsRow = {
  title: string;
  views: number;
  prev_views: number;
  sessions: number;
  visitors: number;
  bounce_rate: number;
  avg_duration: number;
  entry_sessions: number;
  exit_sessions: number;
  scroll_total: number;
  scroll_visits: number;
  time_total: number;
  time_visits: number;
};

/** One path's headline metrics, same definitions as the list query. */
export const pageDetailStatsQuery = async (
  clickhouse: ClickHouseClient,
  input: {
    websiteId: string;
    path: string;
    from: number;
    to: number;
    compareFrom: number;
    compareTo: number;
  },
): Promise<PageDetailStatsRow | null> => {
  const query = `
    WITH
    ${engagementCte("\n        AND url_path = {path:String}").trim()},
    pv AS (
      SELECT page_title, session_id, user_id, timestamp
      FROM events
      WHERE website_id = {websiteId:String}
        AND event_type = 'pageview'
        AND url_path = {path:String}
        AND timestamp >= fromUnixTimestamp({from:UInt32})
        AND timestamp <  fromUnixTimestamp({to:UInt32})
    ),
    sess AS (
      SELECT
        session_id,
        argMax(page_views, updated_at) AS page_views,
        argMax(events, updated_at) AS events,
        argMax(duration_seconds, updated_at) AS duration_seconds,
        argMax(entry_page, updated_at) AS entry_page,
        argMax(exit_page, updated_at) AS exit_page
      FROM sessions
      WHERE website_id = {websiteId:String}
        AND start_time < fromUnixTimestamp({to:UInt32})
        AND end_time >= fromUnixTimestamp({from:UInt32})
      GROUP BY session_id
    )
    SELECT
      (
        SELECT any(t) FROM (
          SELECT argMaxIf(page_title, timestamp, page_title != '') AS t FROM pv
        )
      ) AS title,
      toUInt32(count()) AS views,
      (
        SELECT toUInt32(count())
        FROM events
        WHERE website_id = {websiteId:String}
          AND event_type = 'pageview'
          AND url_path = {path:String}
          AND timestamp >= fromUnixTimestamp({compareFrom:UInt32})
          AND timestamp <  fromUnixTimestamp({compareTo:UInt32})
      ) AS prev_views,
      toUInt32(uniqExact(p.session_id)) AS sessions,
      toUInt32(uniqExact(p.user_id)) AS visitors,
      round(
        countIf(s.events = 1 AND s.entry_page = {path:String})
          / greatest(uniqExact(p.session_id), 1) * 100,
        2
      ) AS bounce_rate,
      toUInt32(round(ifNotFinite(avg(s.duration_seconds), 0))) AS avg_duration,
      (
        SELECT toUInt32(countIf(entry_page = {path:String})) FROM sess
        WHERE session_id IN (SELECT session_id FROM pv)
      ) AS entry_sessions,
      (
        SELECT toUInt32(countIf(exit_page = {path:String})) FROM sess
        WHERE session_id IN (SELECT session_id FROM pv)
      ) AS exit_sessions,
      (SELECT toUInt64(sum(sd)) FROM eng) AS scroll_total,
      (SELECT toUInt64(count()) FROM eng) AS scroll_visits,
      (SELECT toUInt64(round(sum(ms) / 1000)) FROM eng) AS time_total,
      (SELECT toUInt64(count()) FROM eng) AS time_visits
    FROM pv p
    LEFT JOIN sess s USING (session_id)
  `;

  const result = await clickhouse.query({
    query,
    query_params: {
      websiteId: input.websiteId,
      path: input.path,
      from: input.from,
      to: input.to,
      compareFrom: input.compareFrom,
      compareTo: input.compareTo,
    },
    format: "JSONEachRow",
  });

  const rows = await result.json<PageDetailStatsRow>();
  return rows[0] ?? null;
};

export type PageEventRow = {
  name: string;
  total: number;
  visitors: number;
};

/** Custom events fired while on this page. */
export const pageEventsQuery = async (
  clickhouse: ClickHouseClient,
  input: {
    websiteId: string;
    path: string;
    from: number;
    to: number;
    limit: number;
  },
): Promise<PageEventRow[]> => {
  const result = await clickhouse.query({
    query: `
      SELECT
        event_name AS name,
        toUInt32(count()) AS total,
        toUInt32(uniqExact(user_id)) AS visitors
      FROM events
      WHERE website_id = {websiteId:String}
        AND event_type = 'event'
        AND event_name != ''
        AND url_path = {path:String}
        AND timestamp >= fromUnixTimestamp({from:UInt32})
        AND timestamp <  fromUnixTimestamp({to:UInt32})
      GROUP BY name
      ORDER BY total DESC, name ASC
      LIMIT {limit:UInt32}
    `,
    query_params: {
      websiteId: input.websiteId,
      path: input.path,
      from: input.from,
      to: input.to,
      limit: input.limit,
    },
    format: "JSONEachRow",
  });

  return result.json<PageEventRow>();
};
