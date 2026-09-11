import { ClickHouseClient } from "@clickhouse/client";

import {
  AnalyticsFilters,
  buildEventsSessionRestriction,
} from "./filters.js";

export type GoalMatchRow = {
  event_type: string;
  event_name: string;
  url_path: string;
  visitors: number;
  completions: number;
};

/**
 * Fetch conversion counts for the given event names and page paths in one pass.
 *
 * Each goal matches either a custom event name or an exact pageview path, so
 * every goal maps to exactly one group in this result and the caller can join
 * them up in memory. That keeps this to a single ClickHouse round trip no
 * matter how many goals a site has.
 */
export const goalMatchesQuery = async (
  clickhouse: ClickHouseClient,
  input: {
    websiteId: string;
    from: number;
    to: number;
    eventNames: string[];
    pagePaths: string[];
    filters?: AnalyticsFilters;
  },
): Promise<GoalMatchRow[]> => {
  if (!input.eventNames.length && !input.pagePaths.length) return [];

  const query_params: Record<string, unknown> = {
    websiteId: input.websiteId,
    from: input.from,
    to: input.to,
    eventNames: input.eventNames,
    pagePaths: input.pagePaths,
  };
  const restriction = buildEventsSessionRestriction(
    input.filters,
    query_params,
  );

  const result = await clickhouse.query({
    query: `
      SELECT
        event_type,
        event_name,
        url_path,
        toUInt32(uniqExact(user_id)) AS visitors,
        toUInt32(count()) AS completions
      FROM events
      WHERE website_id = {websiteId:String}
        AND timestamp >= fromUnixTimestamp({from:UInt32})
        AND timestamp <  fromUnixTimestamp({to:UInt32})
        AND (
          (event_type = 'event' AND event_name IN ({eventNames:Array(String)}))
          OR
          (event_type = 'pageview' AND url_path IN ({pagePaths:Array(String)}))
        )${restriction}
      GROUP BY event_type, event_name, url_path
    `,
    query_params,
    format: "JSONEachRow",
  });

  return result.json<GoalMatchRow>();
};

/** Denominator for conversion rate: unique visitors in the same window. */
export const totalVisitorsQuery = async (
  clickhouse: ClickHouseClient,
  input: {
    websiteId: string;
    from: number;
    to: number;
    filters?: AnalyticsFilters;
  },
) => {
  const query_params: Record<string, unknown> = {
    websiteId: input.websiteId,
    from: input.from,
    to: input.to,
  };
  const restriction = buildEventsSessionRestriction(
    input.filters,
    query_params,
  );

  const result = await clickhouse.query({
    query: `
      SELECT toUInt32(uniqExact(user_id)) AS visitors
      FROM events
      WHERE website_id = {websiteId:String}
        AND timestamp >= fromUnixTimestamp({from:UInt32})
        AND timestamp <  fromUnixTimestamp({to:UInt32})${restriction}
    `,
    query_params,
    format: "JSONEachRow",
  });

  const rows = await result.json<{ visitors: number }>();
  return rows[0]?.visitors ?? 0;
};

/**
 * Bucketed conversions for one goal, for the goal-detail trend. Buckets are
 * cut in the site's timezone with the same label format as every other series
 * (`bucketFn` comes from the BUCKET_FN allowlist, never from callers).
 */
export const goalTimeseriesQuery = async (
  clickhouse: ClickHouseClient,
  input: {
    websiteId: string;
    from: number;
    to: number;
    eventName?: string | null;
    pagePath?: string | null;
    bucketFn: string;
    timezone: string;
  },
) => {
  const matcher = input.eventName
    ? `event_type = 'event' AND event_name = {target:String}`
    : `event_type = 'pageview' AND url_path = {target:String}`;

  const result = await clickhouse.query({
    query: `
      SELECT
        formatDateTime(
          ${input.bucketFn}(toTimeZone(timestamp, {timezone:String})),
          '%Y-%m-%d %H:%i:00'
        ) AS t,
        toUInt32(uniqExact(user_id)) AS visitors,
        toUInt32(count()) AS completions
      FROM events
      WHERE website_id = {websiteId:String}
        AND timestamp >= fromUnixTimestamp({from:UInt32})
        AND timestamp <  fromUnixTimestamp({to:UInt32})
        AND ${matcher}
      GROUP BY t
      ORDER BY t ASC
    `,
    query_params: {
      websiteId: input.websiteId,
      from: input.from,
      to: input.to,
      target: input.eventName ?? input.pagePath ?? "",
      timezone: input.timezone,
    },
    format: "JSONEachRow",
  });

  return result.json<{ t: string; visitors: number; completions: number }>();
};

/** All custom event names seen in the window, for the goal creation UI. */
export const customEventNamesQuery = async (
  clickhouse: ClickHouseClient,
  input: {
    websiteId: string;
    from: number;
    to: number;
    limit: number;
    filters?: AnalyticsFilters;
  },
) => {
  const query_params: Record<string, unknown> = {
    websiteId: input.websiteId,
    from: input.from,
    to: input.to,
    limit: input.limit,
  };
  const restriction = buildEventsSessionRestriction(
    input.filters,
    query_params,
  );

  const result = await clickhouse.query({
    query: `
      SELECT
        event_name AS name,
        toUInt32(uniqExact(user_id)) AS visitors,
        toUInt32(count()) AS completions
      FROM events
      WHERE website_id = {websiteId:String}
        AND event_type = 'event'
        AND timestamp >= fromUnixTimestamp({from:UInt32})
        AND timestamp <  fromUnixTimestamp({to:UInt32})${restriction}
      GROUP BY name
      ORDER BY visitors DESC, name ASC
      LIMIT {limit:UInt32}
    `,
    query_params,
    format: "JSONEachRow",
  });

  return result.json<{
    name: string;
    visitors: number;
    completions: number;
  }>();
};

/**
 * Property keys seen on one custom event, with how many visitors and events
 * carried each. Properties live as parallel `meta.key`/`meta.value` arrays,
 * so ARRAY JOIN unrolls them to one row per property.
 */
export const customEventPropertyKeysQuery = async (
  clickhouse: ClickHouseClient,
  input: {
    websiteId: string;
    from: number;
    to: number;
    eventName: string;
    limit: number;
    filters?: AnalyticsFilters;
  },
) => {
  const query_params: Record<string, unknown> = {
    websiteId: input.websiteId,
    from: input.from,
    to: input.to,
    eventName: input.eventName,
    limit: input.limit,
  };
  const restriction = buildEventsSessionRestriction(input.filters, query_params);

  const result = await clickhouse.query({
    query: `
      SELECT
        prop_key AS name,
        toUInt32(uniqExact(user_id)) AS visitors,
        toUInt32(count()) AS events,
        toUInt32((
          SELECT uniqExact(user_id)
          FROM events
          WHERE website_id = {websiteId:String}
            AND event_type = 'event'
            AND event_name = {eventName:String}
            AND timestamp >= fromUnixTimestamp({from:UInt32})
            AND timestamp <  fromUnixTimestamp({to:UInt32})${restriction}
        )) AS total_visitors
      FROM events
      ARRAY JOIN meta.key AS prop_key
      WHERE website_id = {websiteId:String}
        AND event_type = 'event'
        AND event_name = {eventName:String}
        AND timestamp >= fromUnixTimestamp({from:UInt32})
        AND timestamp <  fromUnixTimestamp({to:UInt32})${restriction}
      GROUP BY name
      ORDER BY visitors DESC, name ASC
      LIMIT {limit:UInt32}
    `,
    query_params,
    format: "JSONEachRow",
  });

  return result.json<{
    name: string;
    visitors: number;
    events: number;
    total_visitors: number;
  }>();
};

/** Values of one property on one custom event, most visitors first. */
export const customEventPropertyValuesQuery = async (
  clickhouse: ClickHouseClient,
  input: {
    websiteId: string;
    from: number;
    to: number;
    eventName: string;
    key: string;
    limit: number;
    filters?: AnalyticsFilters;
  },
) => {
  const query_params: Record<string, unknown> = {
    websiteId: input.websiteId,
    from: input.from,
    to: input.to,
    eventName: input.eventName,
    key: input.key,
    limit: input.limit,
  };
  const restriction = buildEventsSessionRestriction(input.filters, query_params);

  const result = await clickhouse.query({
    query: `
      WITH matching AS (
        SELECT user_id, prop_value
        FROM events
        ARRAY JOIN meta.key AS prop_key, meta.value AS prop_value
        WHERE website_id = {websiteId:String}
          AND event_type = 'event'
          AND event_name = {eventName:String}
          AND prop_key = {key:String}
          AND timestamp >= fromUnixTimestamp({from:UInt32})
          AND timestamp <  fromUnixTimestamp({to:UInt32})${restriction}
      )
      SELECT
        prop_value AS name,
        toUInt32(uniqExact(user_id)) AS visitors,
        toUInt32(count()) AS events,
        toUInt32((SELECT uniqExact(user_id) FROM matching)) AS total_visitors
      FROM matching
      GROUP BY name
      ORDER BY visitors DESC, name ASC
      LIMIT {limit:UInt32}
    `,
    query_params,
    format: "JSONEachRow",
  });

  return result.json<{
    name: string;
    visitors: number;
    events: number;
    total_visitors: number;
  }>();
};
