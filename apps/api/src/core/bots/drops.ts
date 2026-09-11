import { ClickHouseClient } from "@clickhouse/client";

/**
 * Why the ingest filters refuse a request. Each is one row in
 * `dropped_events`, which the dashboard's "filtered traffic" figure reads.
 */
export type DropReason = "bot_user_agent" | "datacenter_ip" | "referrer_spam" | "scripted_cluster";

export const DROP_REASONS: DropReason[] = [
  "bot_user_agent",
  "datacenter_ip",
  "referrer_spam",
  "scripted_cluster",
];

/**
 * Counts a drop. Fire and forget: a counter must never slow or fail ingest,
 * and ClickHouse batches these server side (`async_insert`) so a bot storm
 * does not become one insert per request.
 */
export const recordDrop = (clickhouse: ClickHouseClient, websiteId: string, reason: DropReason) => {
  clickhouse
    .insert({
      table: "dropped_events",
      values: [{ website_id: websiteId, timestamp: Math.floor(Date.now() / 1000), reason }],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
    })
    .catch((err) => console.error("dropped_events insert failed", err));
};

export type FilteredTraffic = { total: number; reasons: Record<DropReason, number> };

/** Drops for a site in a window (Unix seconds, `to` exclusive), by reason. */
export const countDrops = async (
  clickhouse: ClickHouseClient,
  websiteId: string,
  from: number,
  to: number,
): Promise<FilteredTraffic> => {
  const result = await clickhouse.query({
    query: `
      SELECT reason, count() AS total
      FROM dropped_events
      WHERE website_id = {websiteId:String}
        AND timestamp >= toDateTime({from:UInt32})
        AND timestamp < toDateTime({to:UInt32})
      GROUP BY reason
    `,
    query_params: { websiteId, from, to },
    format: "JSONEachRow",
  });
  const rows = await result.json<{ reason: string; total: string }>();

  const reasons = Object.fromEntries(DROP_REASONS.map((r) => [r, 0])) as Record<DropReason, number>;
  let total = 0;
  for (const row of rows) {
    const n = Number(row.total);
    total += n;
    if (row.reason in reasons) reasons[row.reason as DropReason] = n;
  }
  return { total, reasons };
};
