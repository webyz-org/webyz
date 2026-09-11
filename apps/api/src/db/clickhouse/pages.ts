import { ClickHouseClient } from "@clickhouse/client";

import { Pagination } from "../../core/types/pagination.js";

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
  | "trend";

/** Sort keys are an allowlist mapped to SELECT aliases, never caller input. */
const SORT_EXPR: Record<PagesSortKey, string> = {
  views: "views",
  sessions: "sessions",
  visitors: "visitors",
  bounce_rate: "bounce_rate",
  duration: "avg_duration",
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
  prev_views: number;
  change: number;
  total_pages: number;
};

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
  },
): Promise<PageListRow[]> => {
  const sortExpr = SORT_EXPR[input.sort] ?? SORT_EXPR.views;
  const direction = input.order === "asc" ? "ASC" : "DESC";

  const search = input.search?.trim() ?? "";
  const having = search
    ? `HAVING positionCaseInsensitive(path, {search:String}) > 0
         OR positionCaseInsensitive(title, {search:String}) > 0`
    : "";

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
    prev AS (
      SELECT url_path, toUInt32(count()) AS views
      FROM events
      WHERE website_id = {websiteId:String}
        AND event_type = 'pageview'
        AND timestamp >= fromUnixTimestamp({compareFrom:UInt32})
        AND timestamp <  fromUnixTimestamp({compareTo:UInt32})
      GROUP BY url_path
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
    )
    SELECT
      p.url_path AS path,
      argMaxIf(p.page_title, p.timestamp, p.page_title != '') AS title,
      toUInt32(count()) AS views,
      toUInt32(uniqExact(p.session_id)) AS sessions,
      toUInt32(uniqExact(p.user_id)) AS visitors,
      round(
        countIf(s.events = 1 AND s.entry_page = p.url_path)
          / greatest(uniqExact(p.session_id), 1) * 100,
        2
      ) AS bounce_rate,
      toUInt32(round(ifNotFinite(avg(s.duration_seconds), 0))) AS avg_duration,
      toUInt32(any(pr.views)) AS prev_views,
      round((views - prev_views) / greatest(prev_views, 1) * 100, 1) AS change,
      toUInt32(count() OVER ()) AS total_pages
    FROM pv p
    LEFT JOIN sess s USING (session_id)
    LEFT JOIN prev pr ON pr.url_path = p.url_path
    GROUP BY path
    ${having}
    ORDER BY ${sortExpr} ${direction}, views DESC, sessions DESC, path ASC
    LIMIT {limit:UInt32} OFFSET {offset:UInt32}
  `;

  const result = await clickhouse.query({
    query,
    query_params: {
      websiteId: input.websiteId,
      from: input.from,
      to: input.to,
      compareFrom: input.compareFrom,
      compareTo: input.compareTo,
      search,
      limit: input.pagination.limit,
      offset: input.pagination.offset,
    },
    format: "JSONEachRow",
  });

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
  input: { websiteId: string; from: number; to: number },
): Promise<PagesSummaryRow | null> => {
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
    )
    SELECT
      (SELECT toUInt32(uniqExact(url_path)) FROM pv) AS pages,
      (SELECT toUInt32(count()) FROM pv) AS pageviews,
      (SELECT toUInt32(count()) FROM sess) AS sessions,
      (
        SELECT round(countIf(events = 1) / greatest(count(), 1) * 100, 2)
        FROM sess
      ) AS bounce_rate,
      (
        SELECT toUInt32(round(ifNotFinite(avg(duration_seconds), 0)))
        FROM sess
      ) AS avg_duration,
      (
        SELECT any(p) FROM (
          SELECT url_path AS p
          FROM pv
          GROUP BY url_path
          ORDER BY count() DESC, uniqExact(session_id) DESC, url_path ASC
          LIMIT 1
        )
      ) AS top_page
  `;

  const result = await clickhouse.query({
    query,
    query_params: {
      websiteId: input.websiteId,
      from: input.from,
      to: input.to,
    },
    format: "JSONEachRow",
  });

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
  },
): Promise<PageSparkRow[]> => {
  if (!input.paths.length) return [];

  const result = await clickhouse.query({
    query: `
      SELECT
        url_path AS path,
        formatDateTime(
          ${input.bucketFn}(toTimeZone(timestamp, {timezone:String})),
          '%Y-%m-%d %H:%i:00'
        ) AS t,
        toUInt32(count()) AS views
      FROM events
      WHERE website_id = {websiteId:String}
        AND event_type = 'pageview'
        AND timestamp >= fromUnixTimestamp({from:UInt32})
        AND timestamp <  fromUnixTimestamp({to:UInt32})
        AND url_path IN ({paths:Array(String)})
      GROUP BY path, t
      ORDER BY path, t
    `,
    query_params: {
      websiteId: input.websiteId,
      from: input.from,
      to: input.to,
      paths: input.paths,
      timezone: input.timezone,
    },
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
      ) AS exit_sessions
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
