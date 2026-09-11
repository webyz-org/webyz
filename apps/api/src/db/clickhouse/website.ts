import { ClickHouseClient } from "@clickhouse/client";

/**
 * Remove every analytics row for a site. Each table is its own mutation and
 * each is attempted even if an earlier one failed, so a transient error on one
 * table never leaves the others untouched; the first error is rethrown at the
 * end for the caller to log. ClickHouse mutations are asynchronous: the rows
 * disappear shortly after this resolves.
 */
export const purgeWebsiteAnalytics = async (clickhouse: ClickHouseClient, siteId: string) => {
  const byWebsite = ["events", "sessions", "event_data", "hourly_aggregates"];
  let firstError: unknown = null;

  for (const table of byWebsite) {
    await clickhouse
      .command({
        query: `ALTER TABLE webyz_analytics.${table} DELETE WHERE website_id = {siteId:String}`,
        query_params: { siteId },
      })
      .catch((err) => {
        firstError ??= err;
      });
  }

  if (firstError) throw firstError;
};
