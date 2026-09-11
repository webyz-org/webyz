import { ClickHouseClient } from "@clickhouse/client";
import { TopStatsRow } from "./types.js";
import { AnalyticsFilters, buildSessionFilters } from "./filters.js";

export const topStatsQuery = async (
  clickhouse: ClickHouseClient,
  websiteId: string,
  from: number,
  to: number,
  compareFrom: number,
  compareTo: number,
  filters?: AnalyticsFilters,
): Promise<TopStatsRow | null> => {
  const query_params: Record<string, unknown> = {
    websiteId,
    from,
    to,
    compareFrom,
    compareTo,
  };

  // Same predicates for both windows; only the page-filter subquery differs,
  // because each window restricts by its own time bounds. The second build
  // rebinds the same flt_ parameters with identical values.
  const current = buildSessionFilters(filters, query_params, {
    fromExpr: "fromUnixTimestamp({from:UInt32})",
    toExpr: "fromUnixTimestamp({to:UInt32})",
  });
  const comparison = buildSessionFilters(filters, query_params, {
    fromExpr: "fromUnixTimestamp({compareFrom:UInt32})",
    toExpr: "fromUnixTimestamp({compareTo:UInt32})",
  });

  const dedupColumns = current.columns
    .map((col) => `argMax(${col}, updated_at) AS ${col}`)
    .join(",\n          ");
  const filterWhere = current.clauses.length
    ? `WHERE ${current.clauses.join(" AND ")}`
    : "";

  const windowCte = (fromExpr: string, toExpr: string, restriction: string) => `
        SELECT * FROM (
          SELECT
            session_id,
            argMax(user_id, updated_at) AS user_id,
            argMax(page_views, updated_at) AS page_views,
            argMax(events, updated_at) AS events,
            argMax(duration_seconds, updated_at) AS duration_seconds${dedupColumns ? `,\n          ${dedupColumns}` : ""}
          FROM webyz_analytics.sessions
          WHERE website_id = {websiteId:String}
            AND start_time >= ${fromExpr}
            AND start_time <= ${toExpr}${restriction}
          GROUP BY session_id
        )
        ${filterWhere}`;

  const result = await clickhouse.query({
    query: `
      WITH

      current_sessions AS (${windowCte("fromUnixTimestamp({from:UInt32})", "fromUnixTimestamp({to:UInt32})", current.pageRestriction)}
      ),

      comparison_sessions AS (${windowCte("fromUnixTimestamp({compareFrom:UInt32})", "fromUnixTimestamp({compareTo:UInt32})", comparison.pageRestriction)}
      ),

      current AS (
        SELECT
          uniq(user_id) AS visitors,
          count() AS visits,
          sum(page_views) AS pageviews,
          avg(duration_seconds) AS visit_duration,
          sumIf(1, events = 1) AS bounces
        FROM current_sessions
      ),

      comparison AS (
        SELECT
          uniq(user_id) AS visitors,
          count() AS visits,
          sum(page_views) AS pageviews,
          avg(duration_seconds) AS visit_duration,
          sumIf(1, events = 1) AS bounces
        FROM comparison_sessions
      )

      SELECT
        current.visitors,
        comparison.visitors AS prev_visitors,

        current.visits,
        comparison.visits AS prev_visits,

        current.pageviews,
        comparison.pageviews AS prev_pageviews,

        current.visit_duration,
        comparison.visit_duration AS prev_visit_duration,

        current.bounces,
        comparison.bounces AS prev_bounces
      FROM current
      CROSS JOIN comparison
    `,
    query_params,
  });

  const { data } = await result.json<TopStatsRow>();
  return data.length ? data[0] : null;
};
