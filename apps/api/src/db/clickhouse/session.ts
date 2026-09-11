import { ClickHouseClient } from "@clickhouse/client";

import { toClickHouseDateTime64 } from "../../utils/time.js";
import { SessionRow } from "./types.js";
import { SessionData } from "../../core/tracker/types.js";

/**
 * Read the current state of a session. sessions is a ReplacingMergeTree, so the
 * newest row wins: order by updated_at, not end_time, because a correction can
 * land with the same end_time.
 */
export const getSession = async (
  clickhouse: ClickHouseClient,
  websiteId: string,
  sessionId: string,
): Promise<SessionRow | null> => {
  const result = await clickhouse.query({
    query: `
      SELECT
        session_id,
        website_id,
        user_id,
        toUnixTimestamp(start_time) AS start_time,
        toUnixTimestamp(end_time) AS end_time,
        duration_seconds,
        entry_page,
        exit_page,
        page_views,
        events,
        hostname,
        browser_family,
        browser_version,
        os_family,
        os_version,
        device_type,
        device_brand,
        screen,
        language,
        country,
        sub_division_1,
        sub_division_2,
        city,
        channel,
        referrer_domain,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        utm_term
      FROM sessions
      WHERE website_id = {websiteId:String}
        AND session_id = {sessionId:String}
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    query_params: { websiteId, sessionId },
    format: "JSONEachRow",
  });

  const rows = await result.json<SessionRow>();
  return rows.length ? rows[0] : null;
};

export const upsertSession = async (
  clickhouse: ClickHouseClient,
  session: SessionData,
) => {
  await clickhouse.insert({
    table: "sessions",
    values: [
      {
        session_id: session.sessionId,
        website_id: session.websiteId,
        user_id: session.userId,
        start_time: session.startTime,
        end_time: session.endTime,
        duration_seconds: session.durationSeconds,
        entry_page: session.entryPage,
        exit_page: session.exitPage,
        page_views: session.pageViews,
        events: session.events,
        hostname: session.hostname,
        browser_family: session.browserFamily,
        browser_version: session.browserVersion,
        os_family: session.osFamily,
        os_version: session.osVersion,
        device_type: session.deviceType,
        device_brand: session.deviceBrand,
        screen: session.screen,
        language: session.language,
        country: session.country,
        sub_division_1: session.subdivision1,
        sub_division_2: session.subdivision2,
        city: session.city,
        channel: session.channel,
        referrer_domain: session.referrerDomain,
        utm_source: session.utmSource,
        utm_medium: session.utmMedium,
        utm_campaign: session.utmCampaign,
        utm_content: session.utmContent,
        utm_term: session.utmTerm,
        updated_at: toClickHouseDateTime64(new Date()),
      },
    ],
    format: "JSONEachRow",
  });
};
