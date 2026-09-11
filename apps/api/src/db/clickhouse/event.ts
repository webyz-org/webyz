import { ClickHouseClient } from "@clickhouse/client";
import { toUnixSeconds } from "../../utils/time.js";
import { EventData } from "../../core/tracker/types.js";

/** Cheapest possible "has this site ever received an event" check. */
export const hasAnyEventQuery = async (
  clickhouse: ClickHouseClient,
  websiteId: string,
): Promise<boolean> => {
  const result = await clickhouse.query({
    query: `
      SELECT 1 AS seen
      FROM events
      WHERE website_id = {websiteId:String}
      LIMIT 1
    `,
    query_params: { websiteId },
    format: "JSONEachRow",
  });

  const rows = await result.json<{ seen: number }>();
  return rows.length > 0;
};

export const insertEvent = async (
  clickhouse: ClickHouseClient,
  event: EventData,
) => {
  await clickhouse.insert({
    table: "events",
    values: [
      {
        event_id: event.eventId,
        website_id: event.websiteId,
        session_id: event.sessionId,
        user_id: event.userId,
        event_type: event.eventType,
        event_name: event.eventName,
        timestamp: toUnixSeconds(event.timestamp),
        url_path: event.urlPath,
        url_query: event.urlQuery,
        referrer_path: event.referrerPath,
        referrer_query: event.referrerQuery,
        referrer_domain: event.referrerDomain,
        page_title: event.pageTitle,
        hostname: event.hostname,
        browser: event.browser,
        os: event.os,
        device_type: event.deviceType,
        screen: event.screen,
        language: event.language,
        country: event.country,
        // Column names differ from the EventData fields; anything not mapped
        // here is silently dropped by the client, not rejected.
        sub_division_1: event.subdivision1,
        sub_division_2: event.subdivision2,
        city: event.city,
        utm_source: event.utmSource,
        utm_medium: event.utmMedium,
        utm_campaign: event.utmCampaign,
        utm_content: event.utmContent,
        utm_term: event.utmTerm,
        "meta.key": event.metaKeys,
        "meta.value": event.metaValues,
      },
    ],
    format: "JSONEachRow",
  });
};
