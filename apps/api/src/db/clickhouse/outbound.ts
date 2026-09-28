import { ClickHouseClient } from "@clickhouse/client";

import {
  LINK_EVENT_NAMES,
  OUTBOUND_DOMAIN_EXPR,
  OUTBOUND_HREF_EXPR,
  buildEventsSessionRestriction,
  buildOutboundRowFilters,
  type AnalyticsFilters,
  type LinkEventKind,
} from "./filters.js";

/**
 * How link clicks are grouped: by the destination's host, by the full
 * destination URL, by the page the click happened on, or by the file
 * extension of the destination (meant for downloads: pdf, zip, ...).
 */
export const OUTBOUND_GROUPS = ["domain", "url", "page", "type"] as const;
export type OutboundGroup = (typeof OUTBOUND_GROUPS)[number];

export const isOutboundGroup = (value: string): value is OutboundGroup =>
  (OUTBOUND_GROUPS as readonly string[]).includes(value);

/** Column of the `clicks` CTE each grouping reads. Never from callers. */
const GROUP_COLUMN: Record<OutboundGroup, string> = {
  domain: "host",
  url: "href",
  page: "url_path",
  type: "ext",
};

/** The destination's lowercased file extension, '' when the path has none. */
const EXT_EXPR = `lower(extract(path(${OUTBOUND_HREF_EXPR}), '\\.([A-Za-z0-9]+)$'))`;

type Window = {
  websiteId: string;
  from: number;
  to: number;
  /** Which link event: outbound clicks (default) or file downloads. */
  kind?: LinkEventKind;
  filters?: AnalyticsFilters;
};

/**
 * The `clicks` CTE every outbound query starts from: one row per
 * `Outbound Link: Click` event in the window with a destination, the host
 * derived in SQL, so nothing about the link is stored twice and the
 * tracker's payload stays one event with one property. The dashboard's
 * drill-down filters apply twice: as the usual session restriction (only
 * clicks from sessions that match) and as row predicates on the destination
 * itself, so a filter on a domain narrows the URL and page groupings to that
 * domain's clicks rather than to everything those sessions clicked. Binds
 * `websiteId`, `from`, `to`, `eventName` and the filter values.
 */
const clicksCte = (input: Window, query_params: Record<string, unknown>): string => {
  query_params.websiteId = input.websiteId;
  query_params.from = input.from;
  query_params.to = input.to;
  const kind = input.kind ?? "outbound";
  query_params.eventName = LINK_EVENT_NAMES[kind];
  const rowFilters = buildOutboundRowFilters(input.filters, query_params, kind);
  const restriction = buildEventsSessionRestriction(input.filters, query_params);
  return `
      WITH clicks AS (
        SELECT
          user_id,
          timestamp,
          url_path,
          ${OUTBOUND_HREF_EXPR} AS href,
          ${OUTBOUND_DOMAIN_EXPR} AS host,
          ${EXT_EXPR} AS ext
        FROM events
        WHERE website_id = {websiteId:String}
          AND event_type = 'event'
          AND event_name = {eventName:String}
          AND timestamp >= fromUnixTimestamp({from:UInt32})
          AND timestamp <  fromUnixTimestamp({to:UInt32})
          AND ${OUTBOUND_HREF_EXPR} != ''${rowFilters}${restriction}
      )`;
};

export type OutboundRow = {
  name: string;
  visitors: number;
  clicks: number;
  /** Distinct visitors over every click in scope, for percentages. */
  total_visitors: number;
  total_clicks: number;
  /** Distinct groups in scope, for pagination. */
  dimension_count: number;
};

/** Outbound link clicks in the window, grouped one way, most visitors first. */
export const outboundBreakdownQuery = async (
  clickhouse: ClickHouseClient,
  input: Window & {
    by: OutboundGroup;
    pagination: { limit: number; offset: number };
  },
): Promise<OutboundRow[]> => {
  const query_params: Record<string, unknown> = {
    limit: input.pagination.limit,
    offset: input.pagination.offset,
  };
  const cte = clicksCte(input, query_params);
  const column = GROUP_COLUMN[input.by];

  const result = await clickhouse.query({
    query: `${cte}
      SELECT
        ${column} AS name,
        toUInt32(uniqExact(user_id)) AS visitors,
        toUInt32(count()) AS clicks,
        toUInt32((SELECT uniqExact(user_id) FROM clicks)) AS total_visitors,
        toUInt32((SELECT count() FROM clicks)) AS total_clicks,
        toUInt32((SELECT uniqExact(${column}) FROM clicks)) AS dimension_count
      FROM clicks
      GROUP BY name
      ORDER BY visitors DESC, clicks DESC, name ASC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `,
    query_params,
    format: "JSONEachRow",
  });

  return result.json<OutboundRow>();
};

export type OutboundTotals = {
  clicks: number;
  visitors: number;
  /** Distinct destination hosts. */
  destinations: number;
  /** Distinct destination URLs: the files, for downloads. */
  urls: number;
  pages: number;
};

/** The window's outbound totals in one row (zeros when there were no clicks). */
export const outboundTotalsQuery = async (
  clickhouse: ClickHouseClient,
  input: Window,
): Promise<OutboundTotals> => {
  const query_params: Record<string, unknown> = {};
  const cte = clicksCte(input, query_params);

  const result = await clickhouse.query({
    query: `${cte}
      SELECT
        toUInt32(count()) AS clicks,
        toUInt32(uniqExact(user_id)) AS visitors,
        toUInt32(uniqExact(host)) AS destinations,
        toUInt32(uniqExact(href)) AS urls,
        toUInt32(uniqExact(url_path)) AS pages
      FROM clicks
    `,
    query_params,
    format: "JSONEachRow",
  });

  const rows = await result.json<OutboundTotals>();
  return rows[0] ?? { clicks: 0, visitors: 0, destinations: 0, urls: 0, pages: 0 };
};

/**
 * Outbound clicks and clicking visitors per bucket, cut in the site's
 * timezone with the same label format as every other series (`bucketFn` is
 * from the BUCKET_FN allowlist, never from callers).
 */
export const outboundTimeseriesQuery = async (
  clickhouse: ClickHouseClient,
  input: Window & { bucketFn: string; timezone: string },
) => {
  const query_params: Record<string, unknown> = { timezone: input.timezone };
  const cte = clicksCte(input, query_params);

  const result = await clickhouse.query({
    query: `${cte}
      SELECT
        formatDateTime(
          ${input.bucketFn}(toTimeZone(timestamp, {timezone:String})),
          '%Y-%m-%d %H:%i:00'
        ) AS t,
        toUInt32(count()) AS clicks,
        toUInt32(uniqExact(user_id)) AS visitors
      FROM clicks
      GROUP BY t
      ORDER BY t ASC
    `,
    query_params,
    format: "JSONEachRow",
  });

  return result.json<{ t: string; clicks: number; visitors: number }>();
};
