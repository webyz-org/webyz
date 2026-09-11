import type { ClickHouseClient } from "@clickhouse/client";

import { BILLING_CONFIG } from "../catalog/billing.config.js";
import { toClickHouseDateTime64 } from "../../../utils/time.js";
import type { HourRow } from "./usage-math.js";

/**
 * The definition of a billable event, in one place.
 *
 * A billable event is a stored row in `events` that is a pageview or a custom
 * event, for a website that exists, whose hostname is not a development host.
 * Bot traffic never reaches the table (dropped at ingest), so it is not listed
 * here. Everything the customer sees as "usage", every warning threshold, the
 * free-plan pause and every cent of overage derive from this predicate.
 *
 * Used with ClickHouse query_params: `websiteIds`, `from`, `to`, `excludedHosts`.
 * The time range is half-open: [from, to).
 */
export const BILLABLE_EVENTS_WHERE = `
      website_id IN ({websiteIds: Array(String)})
      AND timestamp >= {from: DateTime64(3)}
      AND timestamp <  {to: DateTime64(3)}
      AND event_type IN ('pageview', 'event')
      AND lower(hostname) NOT IN ({excludedHosts: Array(String)})
`;

export const billableParams = (websiteIds: string[], from: Date, to: Date) => ({
  websiteIds,
  from: toClickHouseDateTime64(from),
  to: toClickHouseDateTime64(to),
  excludedHosts: [...BILLING_CONFIG.usage.nonBillableHostnames],
});

/** Total billable events for a set of sites in [from, to). */
export const countBillableEvents = async (
  clickhouse: ClickHouseClient,
  websiteIds: string[],
  from: Date,
  to: Date,
): Promise<number> => {
  if (websiteIds.length === 0) return 0;

  const result = await clickhouse.query({
    query: `SELECT count() AS total FROM events WHERE ${BILLABLE_EVENTS_WHERE}`,
    query_params: billableParams(websiteIds, from, to),
    format: "JSONEachRow",
  });
  const rows = await result.json<{ total: string }>();
  return Number(rows[0]?.total ?? 0);
};

/**
 * Billable events per UTC hour for a set of sites in [from, to). One grouped
 * query returns every hour in the range, which is how the aggregation job
 * recomputes a whole period idempotently.
 */
export const countBillableEventsByHour = async (
  clickhouse: ClickHouseClient,
  websiteIds: string[],
  from: Date,
  to: Date,
): Promise<HourRow[]> => {
  if (websiteIds.length === 0) return [];

  const result = await clickhouse.query({
    query: `
      SELECT toStartOfHour(timestamp) AS hour, count() AS total
      FROM events
      WHERE ${BILLABLE_EVENTS_WHERE}
      GROUP BY hour
      ORDER BY hour
    `,
    query_params: billableParams(websiteIds, from, to),
    format: "JSONEachRow",
  });
  const rows = await result.json<{ hour: string; total: string }>();

  // ClickHouse renders DateTime('UTC') as "YYYY-MM-DD HH:MM:SS" without a zone.
  return rows.map((r) => ({
    hour: new Date(r.hour.replace(" ", "T") + "Z"),
    count: Number(r.total),
  }));
};
