import { ClickHouseClient } from "@clickhouse/client";

/** Window that counts as "right now", matching Plausible's realtime view. */
export const REALTIME_WINDOW_MINUTES = 5;
export const REALTIME_SERIES_MINUTES = 30;

export const currentVisitorsQuery = async (
  clickhouse: ClickHouseClient,
  websiteId: string,
) => {
  const result = await clickhouse.query({
    query: `
      SELECT toUInt32(uniqExact(user_id)) AS visitors
      FROM events
      WHERE website_id = {websiteId:String}
        AND timestamp >= now() - INTERVAL {minutes:UInt32} MINUTE
    `,
    query_params: { websiteId, minutes: REALTIME_WINDOW_MINUTES },
    format: "JSONEachRow",
  });

  const rows = await result.json<{ visitors: number }>();
  return rows[0]?.visitors ?? 0;
};

/** Per-minute visitor counts for the last 30 minutes, zero-filled by caller. */
export const realtimeSeriesQuery = async (
  clickhouse: ClickHouseClient,
  websiteId: string,
) => {
  const result = await clickhouse.query({
    query: `
      SELECT
        formatDateTime(toStartOfMinute(timestamp), '%Y-%m-%d %H:%i:00') AS t,
        toUInt32(uniqExact(user_id)) AS visitors
      FROM events
      WHERE website_id = {websiteId:String}
        AND timestamp >= now() - INTERVAL {minutes:UInt32} MINUTE
      GROUP BY t
      ORDER BY t ASC
    `,
    query_params: { websiteId, minutes: REALTIME_SERIES_MINUTES },
    format: "JSONEachRow",
  });

  return result.json<{ t: string; visitors: number }>();
};

/** What people are looking at right now. */
export const realtimeTopPagesQuery = async (
  clickhouse: ClickHouseClient,
  websiteId: string,
  limit: number,
) => {
  const result = await clickhouse.query({
    query: `
      SELECT
        url_path AS name,
        toUInt32(uniqExact(user_id)) AS visitors
      FROM events
      WHERE website_id = {websiteId:String}
        AND event_type = 'pageview'
        AND timestamp >= now() - INTERVAL {minutes:UInt32} MINUTE
      GROUP BY name
      ORDER BY visitors DESC, name ASC
      LIMIT {limit:UInt32}
    `,
    query_params: {
      websiteId,
      minutes: REALTIME_WINDOW_MINUTES,
      limit,
    },
    format: "JSONEachRow",
  });

  return result.json<{ name: string; visitors: number }>();
};

// ─── Realtime visitors (the dedicated Realtime page) ────────────────────────
//
// A "visitor" is the tracker's user_id, a "session" its session_id - the
// existing identity model, nothing new. "Active now" means activity within the
// last REALTIME_WINDOW_MINUTES (5), matching the realtime badge; the page's
// window (5/15/30 min) only controls which recent visitors are listed.

// events.country is FixedString(2), so an empty value is two NUL bytes, not
// ''. Every read normalizes it to a plain (possibly empty) string.
const COUNTRY = "replaceAll(toString(country), '\\0', '')";

export type RealtimeVisitorRow = {
  visitor_id: string;
  session_id: string;
  last_active: number;
  first_seen: number;
  country: string;
  region: string;
  city: string;
  browser: string;
  os: string;
  device: string;
  current_path: string;
  pageviews: number;
  events: number;
  referrer_domain: string;
  channel: string;
};

/**
 * One row per visitor seen in the window, newest activity first. Attributes
 * come from each visitor's latest event; channel is the current session's
 * first-touch channel from the sessions table, the existing attribution.
 */
export const realtimeVisitorsQuery = async (
  clickhouse: ClickHouseClient,
  websiteId: string,
  windowMinutes: number,
  limit: number,
): Promise<RealtimeVisitorRow[]> => {
  const result = await clickhouse.query({
    query: `
      WITH sess AS (
        SELECT
          session_id,
          argMax(channel, updated_at) AS channel
        FROM sessions
        WHERE website_id = {websiteId:String}
          AND end_time >= now() - INTERVAL {minutes:UInt32} MINUTE
        GROUP BY session_id
      )
      SELECT
        v.*,
        coalesce(s.channel, '') AS channel
      FROM (
        SELECT
          user_id AS visitor_id,
          argMax(session_id, timestamp) AS session_id,
          toUInt32(toUnixTimestamp(max(timestamp))) AS last_active,
          toUInt32(toUnixTimestamp(min(timestamp))) AS first_seen,
          argMax(${COUNTRY}, timestamp) AS country,
          argMax(sub_division_1, timestamp) AS region,
          argMax(city, timestamp) AS city,
          argMax(browser, timestamp) AS browser,
          argMax(os, timestamp) AS os,
          initcap(lower(argMax(device_type, timestamp))) AS device,
          argMaxIf(url_path, timestamp, event_type = 'pageview') AS current_path,
          toUInt32(countIf(event_type = 'pageview')) AS pageviews,
          toUInt32(countIf(event_type = 'event')) AS events,
          argMin(referrer_domain, timestamp) AS referrer_domain
        FROM events
        WHERE website_id = {websiteId:String}
          AND timestamp >= now() - INTERVAL {minutes:UInt32} MINUTE
        GROUP BY user_id
        ORDER BY last_active DESC
        LIMIT {limit:UInt32}
      ) v
      LEFT JOIN sess s ON s.session_id = v.session_id
      ORDER BY v.last_active DESC
    `,
    query_params: { websiteId, minutes: windowMinutes, limit },
    format: "JSONEachRow",
  });

  return result.json<RealtimeVisitorRow>();
};

export type RealtimeTotalsRow = {
  active_visitors: number;
  window_visitors: number;
  pageviews: number;
  events: number;
  countries: number;
};

/** Window totals in one scan; active = last 5 min regardless of window. */
export const realtimeTotalsQuery = async (
  clickhouse: ClickHouseClient,
  websiteId: string,
  windowMinutes: number,
): Promise<RealtimeTotalsRow> => {
  const result = await clickhouse.query({
    query: `
      SELECT
        toUInt32(uniqExactIf(user_id,
          timestamp >= now() - INTERVAL {activeMinutes:UInt32} MINUTE)) AS active_visitors,
        toUInt32(uniqExact(user_id)) AS window_visitors,
        toUInt32(countIf(event_type = 'pageview')) AS pageviews,
        toUInt32(countIf(event_type = 'event')) AS events,
        toUInt32(uniqExactIf(${COUNTRY}, ${COUNTRY} != '')) AS countries
      FROM events
      WHERE website_id = {websiteId:String}
        AND timestamp >= now() - INTERVAL {minutes:UInt32} MINUTE
    `,
    query_params: {
      websiteId,
      minutes: windowMinutes,
      activeMinutes: REALTIME_WINDOW_MINUTES,
    },
    format: "JSONEachRow",
  });

  const rows = await result.json<RealtimeTotalsRow>();
  return (
    rows[0] ?? {
      active_visitors: 0,
      window_visitors: 0,
      pageviews: 0,
      events: 0,
      countries: 0,
    }
  );
};

export type RealtimeActivityRow = {
  ts: number;
  visitor_id: string;
  event_type: string;
  event_name: string;
  path: string;
  country: string;
};

/** Newest events in the window - the page's live activity feed seed. */
export const realtimeFeedQuery = async (
  clickhouse: ClickHouseClient,
  websiteId: string,
  windowMinutes: number,
  limit: number,
): Promise<RealtimeActivityRow[]> => {
  const result = await clickhouse.query({
    query: `
      SELECT
        toUInt32(toUnixTimestamp(timestamp)) AS ts,
        user_id AS visitor_id,
        event_type,
        event_name,
        url_path AS path,
        ${COUNTRY} AS country
      FROM events
      WHERE website_id = {websiteId:String}
        AND timestamp >= now() - INTERVAL {minutes:UInt32} MINUTE
      ORDER BY timestamp DESC
      LIMIT {limit:UInt32}
    `,
    query_params: { websiteId, minutes: windowMinutes, limit },
    format: "JSONEachRow",
  });

  return result.json<RealtimeActivityRow>();
};

/** One visitor's recent trail, for the details panel. */
export const visitorActivityQuery = async (
  clickhouse: ClickHouseClient,
  websiteId: string,
  visitorId: string,
  windowMinutes: number,
  limit: number,
): Promise<RealtimeActivityRow[]> => {
  const result = await clickhouse.query({
    query: `
      SELECT
        toUInt32(toUnixTimestamp(timestamp)) AS ts,
        user_id AS visitor_id,
        event_type,
        event_name,
        url_path AS path,
        ${COUNTRY} AS country
      FROM events
      WHERE website_id = {websiteId:String}
        AND user_id = {visitorId:String}
        AND timestamp >= now() - INTERVAL {minutes:UInt32} MINUTE
      ORDER BY timestamp DESC
      LIMIT {limit:UInt32}
    `,
    query_params: { websiteId, visitorId, minutes: windowMinutes, limit },
    format: "JSONEachRow",
  });

  return result.json<RealtimeActivityRow>();
};
