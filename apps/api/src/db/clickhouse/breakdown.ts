import { ClickHouseClient } from "@clickhouse/client";

import { Pagination } from "../../core/types/pagination.js";
import {
  AnalyticsFilters,
  buildSessionFilters,
  type FilterOperator,
} from "./filters.js";

/** Direct url_path match for the pages dimension, one clause per operator. */
const pagePredicate = (op: FilterOperator): string => {
  switch (op) {
    case "is":
      return "url_path = {flt_page:String}";
    case "is_not":
      return "url_path != {flt_page:String}";
    case "contains":
      return "positionCaseInsensitive(url_path, {flt_page:String}) > 0";
    case "not_contains":
      return "positionCaseInsensitive(url_path, {flt_page:String}) = 0";
  }
};

/**
 * Generic session breakdown.
 *
 * Why this exists: `sessions` is a ReplacingMergeTree, so a session that has
 * been updated has several physical rows until a background merge collapses
 * them. Aggregating without deduplicating counts a returning visitor once per
 * pageview. The previous per-dimension queries mostly omitted this, which
 * inflated every breakdown and produced percentages over 100.
 *
 * Deduplication is done with `argMax(col, updated_at) ... GROUP BY session_id`
 * rather than `FINAL`. It is exact regardless of merge state and lets the same
 * CTE serve the rows, the visitor total and the cardinality in one round trip.
 *
 * Counts are cast to UInt32 because ClickHouse serialises 64-bit integers as
 * JSON strings, which would otherwise reach the dashboard as "12" not 12.
 */

export type SessionDimension =
  | "browser"
  | "browser_version"
  | "os"
  | "os_version"
  | "device"
  | "screen"
  | "language"
  | "entry_page"
  | "exit_page"
  | "channel"
  | "source"
  | "utm_source"
  | "utm_medium"
  | "utm_campaign"
  | "utm_content"
  | "utm_term"
  | "country"
  | "region"
  | "city";

type DimensionSpec = {
  /** Columns that must survive deduplication for this dimension. */
  columns: string[];
  /** SQL expression producing the label, evaluated over the deduped rows. */
  expr: string;
  /** Rows whose label is empty are dropped (utm tags, geo). */
  excludeEmpty?: boolean;
};

const DIMENSIONS: Record<SessionDimension, DimensionSpec> = {
  browser: { columns: ["browser_family"], expr: "browser_family" },
  browser_version: {
    columns: ["browser_family", "browser_version"],
    expr: "concat(browser_family, ' ', browser_version)",
  },
  os: { columns: ["os_family"], expr: "os_family" },
  os_version: {
    columns: ["os_family", "os_version"],
    expr: "concat(os_family, ' ', os_version)",
  },
  // initcap over lower() so "desktop" and "Desktop" are one row.
  device: { columns: ["device_type"], expr: "initcap(lower(device_type))" },
  // Collected since the first release, surfaced since the sessions table
  // carries them (migration 009); rows written before that are empty and
  // are dropped here rather than shown as a blank label.
  screen: { columns: ["screen"], expr: "screen", excludeEmpty: true },
  language: { columns: ["language"], expr: "language", excludeEmpty: true },
  entry_page: { columns: ["entry_page"], expr: "entry_page" },
  exit_page: { columns: ["exit_page"], expr: "exit_page" },
  channel: {
    columns: ["channel"],
    expr: "if(channel = '', 'Direct', channel)",
  },
  source: {
    columns: ["referrer_domain"],
    expr: "if(referrer_domain = '', '(direct)', referrer_domain)",
  },
  utm_source: {
    columns: ["utm_source"],
    expr: "utm_source",
    excludeEmpty: true,
  },
  utm_medium: {
    columns: ["utm_medium"],
    expr: "utm_medium",
    excludeEmpty: true,
  },
  utm_campaign: {
    columns: ["utm_campaign"],
    expr: "utm_campaign",
    excludeEmpty: true,
  },
  utm_content: {
    columns: ["utm_content"],
    expr: "utm_content",
    excludeEmpty: true,
  },
  utm_term: { columns: ["utm_term"], expr: "utm_term", excludeEmpty: true },
  country: { columns: ["country"], expr: "country", excludeEmpty: true },
  region: {
    columns: ["sub_division_1"],
    expr: "sub_division_1",
    excludeEmpty: true,
  },
  city: { columns: ["city"], expr: "city", excludeEmpty: true },
};

/** Kept as an alias: filters are shared with every other dashboard query. */
export type BreakdownFilters = AnalyticsFilters;

export type BreakdownRow = {
  name: string;
  visitors: number;
  visits: number;
  pageviews: number;
  bounce_rate: number;
  visit_duration: number;
  total_visitors: number;
  dimension_count: number;
};

export type BreakdownInput = {
  websiteId: string;
  from: number;
  to: number;
  dimension: SessionDimension;
  pagination: Pagination;
  filters?: BreakdownFilters;
  /**
   * Restrict to sessions that viewed this page at least once. Used by the
   * page-detail view so its source/device/country breakdowns share the exact
   * dedupe and percentage semantics of every other breakdown.
   */
  pagePath?: string;
  /**
   * Restrict to sessions that completed a goal: fired this custom event, or
   * viewed this page. Used by the goal-detail view. Exactly one of the two
   * fields is set; combining with pagePath is not supported.
   */
  conversion?: { eventName?: string | null; pagePath?: string | null };
};

export const sessionBreakdown = async (
  clickhouse: ClickHouseClient,
  input: BreakdownInput,
): Promise<BreakdownRow[]> => {
  const spec = DIMENSIONS[input.dimension];
  if (!spec) throw new Error(`Unknown dimension: ${input.dimension}`);

  const filters = input.filters ?? {};
  const query_params: Record<string, unknown> = {
    websiteId: input.websiteId,
    from: input.from,
    to: input.to,
    limit: input.pagination.limit,
    offset: input.pagination.offset,
  };

  // Filter columns must survive dedup too, so they are added to the CTE.
  const built = buildSessionFilters(filters, query_params);
  const neededColumns = new Set<string>([...spec.columns, ...built.columns]);
  const filterClauses = [...built.clauses];

  const dedupColumns = [...neededColumns]
    .map((col) => `argMax(${col}, updated_at) AS ${col}`)
    .join(",\n        ");

  // Both restrictions narrow to sessions containing a matching event; only
  // the event matcher differs.
  let pagePathClause = "";
  const sessionRestriction = (matcher: string) => `
        AND session_id IN (
          SELECT DISTINCT session_id
          FROM events
          WHERE website_id = {websiteId:String}
            AND ${matcher}
            AND timestamp >= fromUnixTimestamp({from:UInt32})
            AND timestamp <  fromUnixTimestamp({to:UInt32})
        )`;

  if (input.pagePath) {
    query_params.pagePath = input.pagePath;
    pagePathClause = sessionRestriction(
      `event_type = 'pageview' AND url_path = {pagePath:String}`,
    );
  } else if (input.conversion?.eventName) {
    query_params.goalEvent = input.conversion.eventName;
    pagePathClause = sessionRestriction(
      `event_type = 'event' AND event_name = {goalEvent:String}`,
    );
  } else if (input.conversion?.pagePath) {
    query_params.goalPage = input.conversion.pagePath;
    pagePathClause = sessionRestriction(
      `event_type = 'pageview' AND url_path = {goalPage:String}`,
    );
  }

  // The page drill-down filter composes with the restrictions above.
  pagePathClause += built.pageRestriction;

  const havingClauses = [...filterClauses];
  if (spec.excludeEmpty) havingClauses.push(`${spec.expr} != ''`);
  const whereDeduped = havingClauses.length
    ? `WHERE ${havingClauses.join(" AND ")}`
    : "";

  const query = `
    WITH deduped AS (
      SELECT
        session_id,
        argMax(user_id, updated_at) AS user_id,
        argMax(page_views, updated_at) AS page_views,
        argMax(duration_seconds, updated_at) AS duration_seconds,
        ${dedupColumns}
      FROM sessions
      WHERE website_id = {websiteId:String}
        AND start_time < fromUnixTimestamp({to:UInt32})
        AND end_time >= fromUnixTimestamp({from:UInt32})${pagePathClause}
      GROUP BY session_id
    ),
    filtered AS (
      SELECT * FROM deduped
      ${whereDeduped}
    )
    SELECT
      ${spec.expr} AS name,
      toUInt32(uniqExact(user_id)) AS visitors,
      toUInt32(count()) AS visits,
      toUInt32(sum(page_views)) AS pageviews,
      round(sum(page_views = 1) / count() * 100, 2) AS bounce_rate,
      toUInt32(round(avg(duration_seconds))) AS visit_duration,
      toUInt32((SELECT uniqExact(user_id) FROM filtered)) AS total_visitors,
      toUInt32((SELECT uniqExact(${spec.expr}) FROM filtered)) AS dimension_count
    FROM filtered
    GROUP BY name
    ORDER BY visitors DESC, name ASC
    LIMIT {limit:UInt32} OFFSET {offset:UInt32}
  `;

  const result = await clickhouse.query({
    query,
    query_params,
    format: "JSONEachRow",
  });

  return result.json<BreakdownRow>();
};

/**
 * Page breakdown over the events table. Pages cannot come from `sessions`,
 * which only stores entry and exit, so this counts pageview events and joins
 * back to deduped sessions for bounce rate and time on page.
 */
export type PageBreakdownRow = {
  name: string;
  visitors: number;
  pageviews: number;
  bounce_rate: number;
  visit_duration: number;
  total_visitors: number;
  dimension_count: number;
};

export const pageBreakdown = async (
  clickhouse: ClickHouseClient,
  input: {
    websiteId: string;
    from: number;
    to: number;
    pagination: Pagination;
    filters?: AnalyticsFilters;
  },
): Promise<PageBreakdownRow[]> => {
  const query_params: Record<string, unknown> = {
    websiteId: input.websiteId,
    from: input.from,
    to: input.to,
    limit: input.pagination.limit,
    offset: input.pagination.offset,
  };

  // Session filters keep only pageviews from matching sessions. The page
  // filter is special-cased to a direct path match: on the pages dimension it
  // means "this page", not "sessions that saw this page".
  const { page, ...sessionFilters } = input.filters ?? {};
  const built = buildSessionFilters(sessionFilters, query_params);

  const dedupColumns = built.columns
    .map((col) => `argMax(${col}, updated_at) AS ${col}`)
    .join(",\n        ");
  const sessWhere = built.clauses.length
    ? `WHERE ${built.clauses.join(" AND ")}`
    : "";
  // An event (or goal) filter arrives as pageRestriction; it narrows the
  // sessions CTE just like a column predicate does.
  const sessionRestriction = built.clauses.length || built.pageRestriction
    ? "AND session_id IN (SELECT session_id FROM sess)"
    : "";

  let pageClause = "";
  if (page) {
    query_params.flt_page = page.value;
    pageClause = `AND ${pagePredicate(page.op)}`;
  }

  const query = `
    WITH
    sess AS (
      SELECT * FROM (
        SELECT
          session_id,
          argMax(page_views, updated_at) AS page_views,
          argMax(duration_seconds, updated_at) AS duration_seconds,
          argMax(entry_page, updated_at) AS entry_page${dedupColumns ? `,\n          ${dedupColumns}` : ""}
        FROM sessions
        WHERE website_id = {websiteId:String}
          AND start_time < fromUnixTimestamp({to:UInt32})
          AND end_time >= fromUnixTimestamp({from:UInt32})${built.pageRestriction}
        GROUP BY session_id
      )
      ${sessWhere}
    ),
    pageviews AS (
      SELECT url_path, session_id, user_id
      FROM events
      WHERE website_id = {websiteId:String}
        AND event_type = 'pageview'
        AND timestamp >= fromUnixTimestamp({from:UInt32})
        AND timestamp <  fromUnixTimestamp({to:UInt32})
        ${pageClause}
        ${sessionRestriction}
    )
    SELECT
      p.url_path AS name,
      toUInt32(uniqExact(p.user_id)) AS visitors,
      toUInt32(count()) AS pageviews,
      round(
        countIf(s.page_views = 1 AND s.entry_page = p.url_path)
          / greatest(uniqExact(p.session_id), 1) * 100,
        2
      ) AS bounce_rate,
      toUInt32(round(avg(s.duration_seconds))) AS visit_duration,
      toUInt32((SELECT uniqExact(user_id) FROM pageviews)) AS total_visitors,
      toUInt32((SELECT uniqExact(url_path) FROM pageviews)) AS dimension_count
    FROM pageviews p
    LEFT JOIN sess s USING (session_id)
    GROUP BY name
    ORDER BY visitors DESC, name ASC
    LIMIT {limit:UInt32} OFFSET {offset:UInt32}
  `;

  const result = await clickhouse.query({
    query,
    query_params,
    format: "JSONEachRow",
  });

  return result.json<PageBreakdownRow>();
};
