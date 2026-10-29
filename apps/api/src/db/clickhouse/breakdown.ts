import { ClickHouseClient } from "@clickhouse/client";

import { Pagination } from "../../core/types/pagination.js";
import {
  AnalyticsFilters,
  BROWSER_VERSION_SPEC,
  CHANNEL_SPEC,
  OS_VERSION_SPEC,
  SEARCH_TERM_EXPR,
  buildEventsSessionRestriction,
  buildSessionFilters,
  type FilterOperator,
} from "./filters.js";
import { importedGroupSql, importedVisitorsSql, importedWhere, type ImportedRead } from "./imported.js";

/**
 * The tail of a breakdown with imported rows merged in: tracked rows grouped
 * into raw parts (`native`), the planned imported rows grouped the same way
 * (`imported`, core/imports/imported-plan.ts: the right family, the request's
 * filters applied), added per label, then rates recomputed from the sums.
 * Bounce rate and duration divide by `rate_visits`, the visits that carry
 * bounces and seconds (tracked visits, and imported ones outside page and
 * event rows). `nativeTotalVisitors` is the tracked visitor total over the
 * filtered rows.
 */
const mergedTail = (input: {
  nativeRows: string;
  nativeTotalVisitors: string;
  read: ImportedRead;
  column: string;
  query_params: Record<string, unknown>;
}) => `,
    native AS (${input.nativeRows}),
    imported AS (${importedGroupSql(input.read, input.column, input.query_params)}),
    merged AS (
      SELECT
        name,
        sum(visitors) AS visitors,
        sum(visits) AS visits,
        sum(pageviews) AS pageviews,
        sum(bounces) AS bounces,
        sum(duration) AS duration,
        sum(rate_visits) AS rate_visits
      FROM (SELECT * FROM native UNION ALL SELECT * FROM imported)
      GROUP BY name
    )
    SELECT
      name,
      toUInt32(visitors) AS visitors,
      toUInt32(visits) AS visits,
      toUInt32(pageviews) AS pageviews,
      round(bounces / greatest(rate_visits, 1) * 100, 2) AS bounce_rate,
      toUInt32(round(duration / greatest(rate_visits, 1))) AS visit_duration,
      toUInt32(${input.nativeTotalVisitors} + ${importedVisitorsSql(input.read, input.query_params)}) AS total_visitors,
      toUInt32((SELECT count() FROM merged)) AS dimension_count
    FROM merged
    ORDER BY visitors DESC, name ASC
    LIMIT {limit:UInt32} OFFSET {offset:UInt32}
  `;

/** Direct match on the grouped pageview column, one clause per operator. */
const pagePredicate = (op: FilterOperator, column: string, param: string): string => {
  switch (op) {
    case "is":
      return `${column} = {${param}:String}`;
    case "is_not":
      return `${column} != {${param}:String}`;
    case "contains":
      return `positionCaseInsensitive(${column}, {${param}:String}) > 0`;
    case "not_contains":
      return `positionCaseInsensitive(${column}, {${param}:String}) = 0`;
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
  | "city"
  | "hostname";

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
  // major.minor, the rule every source's versions share (utils/version.ts).
  browser_version: BROWSER_VERSION_SPEC,
  os: { columns: ["os_family"], expr: "os_family" },
  os_version: OS_VERSION_SPEC,
  // initcap over lower() so "desktop" and "Desktop" are one row.
  device: { columns: ["device_type"], expr: "initcap(lower(device_type))" },
  // Collected since the first release, surfaced since the sessions table
  // carries them (migration 009); rows written before that are empty and
  // are dropped here rather than shown as a blank label.
  screen: { columns: ["screen"], expr: "screen", excludeEmpty: true },
  language: { columns: ["language"], expr: "language", excludeEmpty: true },
  entry_page: { columns: ["entry_page"], expr: "entry_page" },
  exit_page: { columns: ["exit_page"], expr: "exit_page" },
  channel: CHANNEL_SPEC,
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
  // The host the visit started on, for sites served from several subdomains.
  hostname: { columns: ["hostname"], expr: "hostname", excludeEmpty: true },
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
  /** Planned imported read; ignored with a page or conversion restriction. */
  imported?: ImportedRead | null;
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

  const merging = Boolean(input.imported && !input.pagePath && !input.conversion);

  const query = `
    WITH deduped AS (
      SELECT
        session_id,
        argMax(user_id, updated_at) AS user_id,
        argMax(page_views, updated_at) AS page_views,
        argMax(events, updated_at) AS events,
        argMax(duration_seconds, updated_at) AS duration_seconds,
        ${dedupColumns}
      FROM sessions
      -- A session belongs to the window it started in, like top-stats and the
      -- graph; an overlap test would also count a session that started before
      -- midnight and was still engaged after it.
      WHERE website_id = {websiteId:String}
        AND start_time >= fromUnixTimestamp({from:UInt32})
        AND start_time <  fromUnixTimestamp({to:UInt32})${pagePathClause}
      GROUP BY session_id
    ),
    filtered AS (
      SELECT * FROM deduped
      ${whereDeduped}
    )${merging ? mergedTail({
      nativeRows: `
      SELECT
        ${spec.expr} AS name,
        toUInt64(uniqExact(user_id)) AS visitors,
        toUInt64(count()) AS visits,
        toUInt64(sum(page_views)) AS pageviews,
        toUInt64(countIf(events = 1)) AS bounces,
        toUInt64(sum(duration_seconds)) AS duration,
        toUInt64(count()) AS rate_visits
      FROM filtered
      GROUP BY name`,
      nativeTotalVisitors: "(SELECT uniqExact(user_id) FROM filtered)",
      read: input.imported!,
      column: input.dimension,
      query_params,
    }) : `
    SELECT
      ${spec.expr} AS name,
      toUInt32(uniqExact(user_id)) AS visitors,
      toUInt32(count()) AS visits,
      toUInt32(sum(page_views)) AS pageviews,
      round(sum(events = 1) / count() * 100, 2) AS bounce_rate,
      toUInt32(round(avg(duration_seconds))) AS visit_duration,
      toUInt32((SELECT uniqExact(user_id) FROM filtered)) AS total_visitors,
      toUInt32((SELECT uniqExact(${spec.expr}) FROM filtered)) AS dimension_count
    FROM filtered
    GROUP BY name
    ORDER BY visitors DESC, name ASC
    LIMIT {limit:UInt32} OFFSET {offset:UInt32}
  `}`;

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
    imported?: ImportedRead | null;
    /** Group by path (the Pages list, default) or by page title. */
    column?: "url_path" | "page_title";
  },
): Promise<PageBreakdownRow[]> => {
  const column = input.column ?? "url_path";
  const filterKey = column === "url_path" ? "page" : "title";
  // A bounce is a one-pageview session, so it entered on the page it saw;
  // titles have no entry column to compare, and need none for that reason.
  const bounceCondition = column === "url_path" ? "s.events = 1 AND s.entry_page = p.url_path" : "s.events = 1";
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
  const { [filterKey]: page, ...sessionFilters } = input.filters ?? {};
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

  let pageClause = column === "page_title" ? "AND page_title != ''" : "";
  if (page) {
    query_params[`flt_${filterKey}`] = page.value;
    pageClause += ` AND ${pagePredicate(page.op, column, `flt_${filterKey}`)}`;
  }

  const query = `
    WITH
    sess AS (
      SELECT * FROM (
        SELECT
          session_id,
          argMax(page_views, updated_at) AS page_views,
          argMax(events, updated_at) AS events,
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
      SELECT ${column} AS url_path, session_id, user_id
      FROM events
      WHERE website_id = {websiteId:String}
        AND event_type = 'pageview'
        AND timestamp >= fromUnixTimestamp({from:UInt32})
        AND timestamp <  fromUnixTimestamp({to:UInt32})
        ${pageClause}
        ${sessionRestriction}
    )${input.imported ? mergedTail({
      // Per page: bounces are sessions that entered here and saw nothing
      // else, duration the page's sessions' total, both over its sessions.
      nativeRows: `
      SELECT
        p.url_path AS name,
        toUInt64(uniqExact(p.user_id)) AS visitors,
        toUInt64(uniqExact(p.session_id)) AS visits,
        toUInt64(count()) AS pageviews,
        toUInt64(countIf(${bounceCondition})) AS bounces,
        toUInt64(round(ifNotFinite(avg(s.duration_seconds), 0) * uniqExact(p.session_id))) AS duration,
        toUInt64(uniqExact(p.session_id)) AS rate_visits
      FROM pageviews p
      LEFT JOIN sess s USING (session_id)
      GROUP BY name`,
      nativeTotalVisitors: "(SELECT uniqExact(user_id) FROM pageviews)",
      read: input.imported,
      column: filterKey,
      query_params,
    }) : `
    SELECT
      p.url_path AS name,
      toUInt32(uniqExact(p.user_id)) AS visitors,
      toUInt32(count()) AS pageviews,
      round(
        countIf(${bounceCondition})
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
  `}`;

  const result = await clickhouse.query({
    query,
    query_params,
    format: "JSONEachRow",
  });

  return result.json<PageBreakdownRow>();
};

/**
 * Site search terms: pageviews whose URL carries a search parameter
 * (SEARCH_TERM_EXPR), grouped by term. `pageviews` is the number of searches,
 * so the row fits the breakdown shape; bounce and duration do not apply to a
 * search and stay 0. Imported GA4 `view_search_results` counts merge in.
 */
export const searchTermBreakdown = async (
  clickhouse: ClickHouseClient,
  input: {
    websiteId: string;
    from: number;
    to: number;
    pagination: Pagination;
    filters?: AnalyticsFilters;
    imported?: ImportedRead | null;
  },
): Promise<BreakdownRow[]> => {
  const { search_term: term, ...sessionFilters } = input.filters ?? {};
  const query_params: Record<string, unknown> = {
    websiteId: input.websiteId,
    from: input.from,
    to: input.to,
    limit: input.pagination.limit,
    offset: input.pagination.offset,
  };
  const restriction = buildEventsSessionRestriction(sessionFilters, query_params);
  let termClause = "";
  if (term) {
    query_params.flt_search_term = term.value;
    termClause = `AND ${pagePredicate(term.op, SEARCH_TERM_EXPR, "flt_search_term")}`;
  }

  let importedRows = "";
  let importedTotal = "0";
  if (input.imported) {
    const where = importedWhere(input.imported, query_params);
    importedRows = `
          UNION ALL
          SELECT search_term AS name, toUInt64(sum(visitors)), toUInt64(sum(events))
          FROM webyz_analytics.imported_stats
          WHERE ${where} AND search_term != ''
          GROUP BY name`;
    importedTotal = `(SELECT sum(visitors) FROM webyz_analytics.imported_stats WHERE ${where})`;
  }

  const result = await clickhouse.query({
    query: `
      WITH
      searches AS (
        SELECT ${SEARCH_TERM_EXPR} AS term, user_id
        FROM events
        WHERE website_id = {websiteId:String}
          AND event_type = 'pageview'
          AND timestamp >= fromUnixTimestamp({from:UInt32})
          AND timestamp <  fromUnixTimestamp({to:UInt32})
          AND ${SEARCH_TERM_EXPR} != ''
          ${termClause}${restriction}
      ),
      merged AS (
        SELECT name, sum(visitors) AS visitors, sum(searches) AS searches
        FROM (
          SELECT term AS name, toUInt64(uniqExact(user_id)) AS visitors, toUInt64(count()) AS searches
          FROM searches GROUP BY name${importedRows}
        )
        GROUP BY name
      )
      SELECT
        name,
        toUInt32(visitors) AS visitors,
        toUInt32(searches) AS visits,
        toUInt32(searches) AS pageviews,
        0 AS bounce_rate,
        0 AS visit_duration,
        toUInt32((SELECT uniqExact(user_id) FROM searches) + ${importedTotal}) AS total_visitors,
        toUInt32((SELECT count() FROM merged)) AS dimension_count
      FROM merged
      ORDER BY visitors DESC, searches DESC, name ASC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `,
    query_params,
    format: "JSONEachRow",
  });
  return result.json<BreakdownRow>();
};
