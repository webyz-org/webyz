import { ClickHouseClient } from "@clickhouse/client";

import { toUnixSeconds } from "../../utils/time.js";
import { EventData, SessionData } from "./types.js";
import { getSession, upsertSession } from "../../db/clickhouse/session.js";
import { sessionRowToData } from "./session.service.js";
import { insertEngagement } from "../../db/clickhouse/engagement.js";

export type Engagement = { ms: number; scrollDepth: number };

/**
 * Apply an engagement report to a session row (pure, so it is testable).
 *
 * The visit now ends when the visitor last had the page in front of them,
 * not when the last pageview arrived, so a single-page visit that was read
 * for two minutes is a two minute visit rather than 0 s. Visible time is
 * summed and scroll depth is the deepest seen. Every other column is carried
 * forward untouched: the table is a ReplacingMergeTree and a re-insert that
 * omits a column loses it.
 */
export const applyEngagement = (
  row: SessionData,
  engagement: Engagement,
  reportedAt: number,
): SessionData => {
  const endTime = Math.max(row.endTime, reportedAt);
  return {
    ...row,
    endTime,
    durationSeconds: Math.max(0, endTime - row.startTime),
    engagedSeconds: row.engagedSeconds + Math.round(engagement.ms / 1000),
    scrollDepth: Math.max(row.scrollDepth, engagement.scrollDepth),
  };
};

/**
 * Record an engagement report against its session.
 *
 * A report with no session to attach to is dropped: the session has expired
 * (the page was open for over thirty minutes with no visibility change) or
 * its pageview was filtered as a bot, and in neither case should a session
 * be minted from an engagement alone. Plausible makes the same choice.
 */
export const recordEngagement = async (
  clickhouse: ClickHouseClient,
  event: EventData,
  engagement: Engagement,
): Promise<boolean> => {
  const existing = await getSession(clickhouse, event.websiteId, event.sessionId);
  if (!existing) return false;

  const row = sessionRowToData(existing);

  const reportedAt = toUnixSeconds(event.timestamp);
  await upsertSession(clickhouse, applyEngagement(row, engagement, reportedAt));
  await insertEngagement(clickhouse, {
    websiteId: event.websiteId,
    sessionId: event.sessionId,
    userId: event.userId,
    timestamp: reportedAt,
    urlPath: event.urlPath,
    engagedMs: engagement.ms,
    scrollDepth: engagement.scrollDepth,
  });
  return true;
};
