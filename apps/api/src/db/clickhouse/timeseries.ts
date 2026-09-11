import { ClickHouseClient } from "@clickhouse/client";

import { AnalyticsFilters, buildSessionFilters } from "./filters.js";

export type Interval = "minute" | "hour" | "day" | "week" | "month";

/**
 * Metric expressions over deduplicated session rows.
 *
 * These run on the output of an argMax dedupe, so `count()` is one row per
 * session. The previous version aggregated raw ReplacingMergeTree rows, which
 * counted every session once per pageview and inflated the whole graph.
 */
const METRIC_SQL: Record<string, string> = {
  visitors: "toUInt32(uniqExact(user_id))",
  visits: "toUInt32(count())",
  pageviews: "toUInt32(sum(page_views))",
  views_per_visit: "round(sum(page_views) / greatest(count(), 1), 2)",
  bounce_rate: "round(countIf(events = 1) / greatest(count(), 1) * 100, 2)",
  visit_duration: "toUInt32(round(avg(duration_seconds)))",
};

export const BUCKET_FN: Record<Interval, string> = {
  minute: "toStartOfMinute",
  hour: "toStartOfHour",
  day: "toStartOfDay",
  week: "toStartOfWeek",
  month: "toStartOfMonth",
};

/**
 * hourly_aggregates / hourly_aggregates_mv are intentionally not used here.
 * Buckets are cut in the site's timezone, and offsets such as Asia/Kolkata
 * (+05:30) do not align to whole UTC hours, so pre-aggregated hourly buckets
 * cannot be re-sliced without skewing the series. Reading deduped sessions is
 * correct at any offset; revisit the MV only for whole-hour timezones.
 */
export const timeseriesQuery = async (
  clickhouse: ClickHouseClient,
  input: {
    websiteId: string;
    from: number;
    to: number;
    metric: string;
    interval: Interval;
    timezone: string;
    filters?: AnalyticsFilters;
  },
) => {
  const metricSelect = METRIC_SQL[input.metric] ?? METRIC_SQL.visits;
  const bucketFn = BUCKET_FN[input.interval] ?? "toStartOfHour";

  const query_params: Record<string, unknown> = {
    websiteId: input.websiteId,
    from: input.from,
    to: input.to,
    timezone: input.timezone,
  };

  const built = buildSessionFilters(input.filters, query_params);
  const dedupColumns = built.columns
    .map((col) => `argMax(${col}, updated_at) AS ${col}`)
    .join(",\n          ");
  const filterWhere = built.clauses.length
    ? `WHERE ${built.clauses.join(" AND ")}`
    : "";

  const result = await clickhouse.query({
    query: `
      WITH deduped AS (
        SELECT * FROM (
          SELECT
            session_id,
            argMax(user_id, updated_at) AS user_id,
            argMax(page_views, updated_at) AS page_views,
            argMax(events, updated_at) AS events,
            argMax(duration_seconds, updated_at) AS duration_seconds,
            -- Aliasing this as start_time would shadow the column in WHERE
            -- above and ClickHouse rejects the query (ILLEGAL_AGGREGATION).
            argMax(start_time, updated_at) AS session_start${dedupColumns ? `,\n          ${dedupColumns}` : ""}
          FROM sessions
          WHERE website_id = {websiteId:String}
            AND start_time >= fromUnixTimestamp({from:UInt32})
            AND start_time <  fromUnixTimestamp({to:UInt32})${built.pageRestriction}
          GROUP BY session_id
        )
        ${filterWhere}
      )
      SELECT
        formatDateTime(
          ${bucketFn}(toTimeZone(session_start, {timezone:String})),
          '%Y-%m-%d %H:%i:00'
        ) AS t,
        ${metricSelect} AS value
      FROM deduped
      GROUP BY t
      ORDER BY t ASC
    `,
    query_params,
    format: "JSONEachRow",
  });

  return result.json<{ t: string; value: number }>();
};
