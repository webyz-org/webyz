import { ClickHouseClient } from "@clickhouse/client";

export type EngagementRow = {
  websiteId: string;
  sessionId: string;
  userId: string;
  /** Unix seconds, server receive time. */
  timestamp: number;
  urlPath: string;
  engagedMs: number;
  scrollDepth: number;
};

/** One engagement report; the per-page detail behind time on page and scroll depth. */
export const insertEngagement = async (clickhouse: ClickHouseClient, row: EngagementRow) => {
  await clickhouse.insert({
    table: "engagements",
    values: [
      {
        website_id: row.websiteId,
        session_id: row.sessionId,
        user_id: row.userId,
        timestamp: row.timestamp,
        url_path: row.urlPath,
        engaged_ms: row.engagedMs,
        scroll_depth: row.scrollDepth,
      },
    ],
    format: "JSONEachRow",
  });
};
