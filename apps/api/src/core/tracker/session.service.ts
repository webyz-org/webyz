import { ClickHouseClient } from "@clickhouse/client";

import { toUnixSeconds } from "../../utils/time.js";
import { EventData, SessionData, SessionUAInfo } from "../../core/tracker/types.js";
import { getSession, upsertSession } from "../../db/clickhouse/session.js";
import { classifyChannel } from "../../ingest/helpers/channel.js";

/**
 * Write or extend the session row for a pageview.
 *
 * The sessions table is a ReplacingMergeTree keyed on (website_id, session_id)
 * and versioned by updated_at, so "updating" a session means re-inserting the
 * whole row with a newer updated_at. Every column therefore has to be carried
 * forward explicitly; anything omitted is silently lost on the next pageview.
 *
 * Attribution is first-touch: the channel and utm/referrer fields are computed
 * when the session is created and preserved for the rest of the session, so a
 * visitor who arrives from a campaign and then navigates internally stays
 * attributed to that campaign.
 */
export const updateSession = async (
  clickhouse: ClickHouseClient,
  event: EventData,
  isNewSession: boolean,
  uaInfo: SessionUAInfo,
) => {
  const existingSession = await getSession(
    clickhouse,
    event.websiteId,
    event.sessionId,
  );

  const eventTimestamp = toUnixSeconds(event.timestamp);

  if (existingSession && !isNewSession) {
    const sessionData: SessionData = {
      sessionId: existingSession.session_id,
      websiteId: existingSession.website_id,
      userId: existingSession.user_id,
      startTime: existingSession.start_time,
      endTime: eventTimestamp,
      durationSeconds: Math.max(0, eventTimestamp - existingSession.start_time),
      entryPage: existingSession.entry_page,
      exitPage: event.urlPath,
      pageViews: Number(existingSession.page_views) + 1,
      events: Number(existingSession.events) + 1,
      hostname: existingSession.hostname,
      browserFamily: existingSession.browser_family,
      browserVersion: existingSession.browser_version,
      osFamily: existingSession.os_family,
      osVersion: existingSession.os_version,
      deviceType: existingSession.device_type,
      deviceBrand: existingSession.device_brand,
      screen: existingSession.screen ?? "",
      language: existingSession.language ?? "",
      country: existingSession.country,
      subdivision1: existingSession.sub_division_1 ?? "",
      subdivision2: existingSession.sub_division_2 ?? "",
      city: existingSession.city,

      // Preserved from first touch.
      channel: existingSession.channel ?? "",
      referrerDomain: existingSession.referrer_domain ?? "",
      utmSource: existingSession.utm_source ?? "",
      utmMedium: existingSession.utm_medium ?? "",
      utmCampaign: existingSession.utm_campaign ?? "",
      utmContent: existingSession.utm_content ?? "",
      utmTerm: existingSession.utm_term ?? "",
    };

    await upsertSession(clickhouse, sessionData);
    return;
  }

  const utmSource = event.utmSource ?? "";
  const utmMedium = event.utmMedium ?? "";
  const referrerDomain = event.referrerDomain ?? "";

  const sessionData: SessionData = {
    sessionId: event.sessionId,
    websiteId: event.websiteId,
    userId: event.userId,
    startTime: eventTimestamp,
    endTime: eventTimestamp,
    durationSeconds: 0,
    entryPage: event.urlPath,
    exitPage: event.urlPath,
    pageViews: 1,
    events: 1,
    hostname: event.hostname,
    country: event.country,
    subdivision1: event.subdivision1 ?? "",
    subdivision2: event.subdivision2 ?? "",
    city: event.city,

    browserFamily: uaInfo.browserFamily,
    browserVersion: uaInfo.browserVersion,
    osFamily: uaInfo.osFamily,
    osVersion: uaInfo.osVersion,
    deviceType: uaInfo.deviceType,
    deviceBrand: uaInfo.deviceBrand,
    screen: event.screen ?? "",
    language: event.language ?? "",

    channel: classifyChannel({ utmMedium, utmSource, referrerDomain }),
    referrerDomain,
    utmSource,
    utmMedium,
    utmCampaign: event.utmCampaign ?? "",
    utmContent: event.utmContent ?? "",
    utmTerm: event.utmTerm ?? "",
  };

  await upsertSession(clickhouse, sessionData);
};
