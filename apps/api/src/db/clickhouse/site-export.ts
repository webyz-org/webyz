import { ClickHouseClient } from "@clickhouse/client";
import type { Readable } from "node:stream";

import { OUTBOUND_HREF_EXPR, VERSION_SQL } from "./filters.js";

/**
 * A site's tracked data as Plausible's import CSVs (the format
 * docs/importing.md#csv-format describes and core/imports/plausible-csv.ts
 * reads), one query per file, daily in the site's timezone. Column names and
 * order follow Plausible's `Plausible.Exports`, so the archive imports into
 * Webyz or into Plausible as it is.
 *
 * Every query binds `websiteId`, `from`, `to` (Unix seconds, already cut to
 * the plan's retention) and `timezone`. Most stream straight out of
 * ClickHouse as CSVWithNames; locations come back as rows because their
 * region and city are written as codes the caller looks up.
 */

export type ExportParams = { websiteId: string; from: number; to: number; timezone: string };

/** Deduped sessions of the window, every column the exports read. */
const SESSIONS = `
    sess AS (
      SELECT
        session_id,
        argMax(user_id, updated_at) AS user_id,
        argMax(start_time, updated_at) AS st,
        argMax(page_views, updated_at) AS pv,
        argMax(events, updated_at) AS ev,
        argMax(duration_seconds, updated_at) AS dur,
        argMax(entry_page, updated_at) AS entry_page,
        argMax(exit_page, updated_at) AS exit_page,
        argMax(referrer_domain, updated_at) AS referrer_domain,
        argMax(utm_source, updated_at) AS utm_source,
        argMax(utm_medium, updated_at) AS utm_medium,
        argMax(utm_campaign, updated_at) AS utm_campaign,
        argMax(utm_content, updated_at) AS utm_content,
        argMax(utm_term, updated_at) AS utm_term,
        argMax(country, updated_at) AS country,
        argMax(sub_division_1, updated_at) AS region,
        argMax(city, updated_at) AS city,
        argMax(device_type, updated_at) AS device_type,
        argMax(browser_family, updated_at) AS browser_family,
        argMax(browser_version, updated_at) AS browser_version,
        argMax(os_family, updated_at) AS os_family,
        argMax(os_version, updated_at) AS os_version
      FROM webyz_analytics.sessions
      WHERE website_id = {websiteId:String}
        AND start_time >= fromUnixTimestamp({from:UInt32})
        AND start_time <  fromUnixTimestamp({to:UInt32})
      GROUP BY session_id
    )`;

const DAY = "toDate(st, {timezone:String})";
const EVENT_DAY = "toDate(timestamp, {timezone:String})";
const EVENTS_WINDOW = `
        website_id = {websiteId:String}
        AND timestamp >= fromUnixTimestamp({from:UInt32})
        AND timestamp <  fromUnixTimestamp({to:UInt32})`;

/** visitors, visits, visit_duration, bounces, pageviews over deduped sessions. */
const SESSION_METRICS = `
        toUInt64(uniqExact(user_id)) AS visitors,
        toUInt64(count()) AS visits,
        toUInt64(sum(dur)) AS visit_duration,
        toUInt64(countIf(ev = 1)) AS bounces,
        toUInt64(sum(pv)) AS pageviews`;

/** The streamed reports, in Plausible's file order. Locations are separate. */
export const EXPORT_QUERIES: Array<{ report: string; sql: string }> = [
  {
    report: "imported_visitors",
    sql: `WITH ${SESSIONS}
      SELECT ${DAY} AS date, toUInt64(uniqExact(user_id)) AS visitors, toUInt64(sum(pv)) AS pageviews,
             toUInt64(countIf(ev = 1)) AS bounces, toUInt64(count()) AS visits, toUInt64(sum(dur)) AS visit_duration
      FROM sess GROUP BY date ORDER BY date`,
  },
  {
    // Webyz keeps the referrer host, not a source name; it goes in both
    // columns, and an importer reading the referrer (Webyz's and Plausible's)
    // recovers the same source.
    report: "imported_sources",
    sql: `WITH ${SESSIONS}
      SELECT ${DAY} AS date, referrer_domain AS source, referrer_domain AS referrer,
             utm_source, utm_medium, utm_campaign, utm_content, utm_term,
             toUInt64(sum(pv)) AS pageviews, toUInt64(uniqExact(user_id)) AS visitors, toUInt64(count()) AS visits,
             toUInt64(sum(dur)) AS visit_duration, toUInt64(countIf(ev = 1)) AS bounces
      FROM sess
      GROUP BY date, source, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term
      ORDER BY date`,
  },
  {
    report: "imported_pages",
    sql: `WITH
      pv AS (
        SELECT ${EVENT_DAY} AS date, url_path AS page, any(hostname) AS hostname,
               toUInt64(uniqExact(session_id)) AS visits, toUInt64(uniqExact(user_id)) AS visitors,
               toUInt64(count()) AS pageviews
        FROM webyz_analytics.events
        WHERE ${EVENTS_WINDOW} AND event_type = 'pageview'
        GROUP BY date, page
      ),
      eng AS (
        SELECT date, page, toUInt64(sum(sd)) AS total_scroll_depth, toUInt64(count()) AS total_scroll_depth_visits,
               toUInt64(round(sum(ms) / 1000)) AS total_time_on_page, toUInt64(count()) AS total_time_on_page_visits
        FROM (
          SELECT ${EVENT_DAY} AS date, url_path AS page, session_id, max(scroll_depth) AS sd, sum(engaged_ms) AS ms
          FROM webyz_analytics.engagements
          WHERE ${EVENTS_WINDOW}
          GROUP BY date, page, session_id
        )
        GROUP BY date, page
      )
      SELECT pv.date AS date, pv.hostname AS hostname, pv.page AS page, pv.visits AS visits, pv.visitors AS visitors,
             pv.pageviews AS pageviews, eng.total_scroll_depth AS total_scroll_depth,
             eng.total_scroll_depth_visits AS total_scroll_depth_visits, eng.total_time_on_page AS total_time_on_page,
             eng.total_time_on_page_visits AS total_time_on_page_visits
      FROM pv LEFT JOIN eng ON eng.date = pv.date AND eng.page = pv.page
      ORDER BY date
      SETTINGS join_use_nulls = 0`,
  },
  {
    report: "imported_entry_pages",
    sql: `WITH ${SESSIONS}
      SELECT ${DAY} AS date, entry_page, toUInt64(uniqExact(user_id)) AS visitors, toUInt64(count()) AS entrances,
             toUInt64(sum(dur)) AS visit_duration, toUInt64(countIf(ev = 1)) AS bounces, toUInt64(sum(pv)) AS pageviews
      FROM sess GROUP BY date, entry_page ORDER BY date`,
  },
  {
    report: "imported_exit_pages",
    sql: `WITH ${SESSIONS}
      SELECT ${DAY} AS date, exit_page, toUInt64(uniqExact(user_id)) AS visitors, toUInt64(sum(dur)) AS visit_duration,
             toUInt64(count()) AS exits, toUInt64(countIf(ev = 1)) AS bounces, toUInt64(sum(pv)) AS pageviews
      FROM sess GROUP BY date, exit_page ORDER BY date`,
  },
  {
    // link_url for the link events, path for 404 (the tracker's `page` prop),
    // as Plausible fills them for its own system events.
    report: "imported_custom_events",
    sql: `
      SELECT ${EVENT_DAY} AS date, event_name AS name,
             if(event_name IN ('Outbound Link: Click', 'File Download'), ${OUTBOUND_HREF_EXPR}, '') AS link_url,
             if(event_name = '404', meta.value[indexOf(meta.key, 'page')], '') AS path,
             toUInt64(uniqExact(user_id)) AS visitors, toUInt64(count()) AS events
      FROM webyz_analytics.events
      WHERE ${EVENTS_WINDOW} AND event_type = 'event' AND event_name != ''
      GROUP BY date, name, link_url, path
      ORDER BY date`,
  },
  {
    report: "imported_devices",
    sql: `WITH ${SESSIONS}
      SELECT ${DAY} AS date, initcap(lower(device_type)) AS device, ${SESSION_METRICS}
      FROM sess WHERE device_type != '' GROUP BY date, device ORDER BY date`,
  },
  {
    report: "imported_browsers",
    sql: `WITH ${SESSIONS}
      SELECT ${DAY} AS date, browser_family AS browser, ${VERSION_SQL("browser_version")} AS browser_version, ${SESSION_METRICS}
      FROM sess WHERE browser_family != '' GROUP BY date, browser, browser_version ORDER BY date`,
  },
  {
    report: "imported_operating_systems",
    sql: `WITH ${SESSIONS}
      SELECT ${DAY} AS date, os_family AS operating_system, ${VERSION_SQL("os_version")} AS operating_system_version,
             ${SESSION_METRICS}
      FROM sess WHERE os_family != '' GROUP BY date, operating_system, operating_system_version ORDER BY date`,
  },
  {
    report: "imported_custom_props",
    sql: `
      SELECT ${EVENT_DAY} AS date, k AS property, v AS value,
             toUInt64(uniqExact(user_id)) AS visitors, toUInt64(count()) AS events
      FROM webyz_analytics.events
      ARRAY JOIN meta.key AS k, meta.value AS v
      WHERE ${EVENTS_WINDOW} AND event_type = 'event'
      GROUP BY date, property, value
      ORDER BY date`,
  },
];

/** One report as CSV bytes straight from ClickHouse. */
export const exportReportStream = async (
  clickhouse: ClickHouseClient,
  sql: string,
  params: ExportParams,
): Promise<Readable> => {
  const result = await clickhouse.exec({
    query: `${sql}\nFORMAT CSVWithNames`,
    query_params: params,
  });
  return result.stream as Readable;
};

export type ExportLocationRow = {
  date: string;
  country: string;
  region: string;
  city: string;
  visitors: string;
  visits: string;
  visit_duration: string;
  bounces: string;
  pageviews: string;
};

/** Locations as rows, region and city still names. */
export const exportLocationRows = async (
  clickhouse: ClickHouseClient,
  params: ExportParams,
): Promise<ExportLocationRow[]> => {
  const result = await clickhouse.query({
    query: `WITH ${SESSIONS}
      SELECT toString(${DAY}) AS date, country, region, city, ${SESSION_METRICS}
      FROM sess WHERE country != '' AND country != 'ZZ'
      GROUP BY date, country, region, city ORDER BY date`,
    query_params: params,
    format: "JSONEachRow",
  });
  return result.json<ExportLocationRow>();
};

/** First and last local day with a tracked session in the window, or null. */
export const exportDateSpan = async (
  clickhouse: ClickHouseClient,
  params: ExportParams,
): Promise<{ first: string; last: string } | null> => {
  const result = await clickhouse.query({
    query: `
      SELECT toString(toDate(min(start_time), {timezone:String})) AS first,
             toString(toDate(max(start_time), {timezone:String})) AS last, count() AS n
      FROM webyz_analytics.sessions
      WHERE website_id = {websiteId:String}
        AND start_time >= fromUnixTimestamp({from:UInt32})
        AND start_time <  fromUnixTimestamp({to:UInt32})`,
    query_params: params,
    format: "JSONEachRow",
  });
  const [row] = await result.json<{ first: string; last: string; n: string }>();
  return row && Number(row.n) > 0 ? { first: row.first, last: row.last } : null;
};
