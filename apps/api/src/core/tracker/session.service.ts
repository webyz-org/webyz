import { ClickHouseClient } from "@clickhouse/client";

import { toUnixSeconds } from "../../utils/time.js";
import { EventData, SessionData, SessionUAInfo } from "../../core/tracker/types.js";
import { getSession, upsertSession } from "../../db/clickhouse/session.js";
import type { SessionRow } from "../../db/clickhouse/types.js";
import { classifyChannel } from "../../ingest/helpers/channel.js";

/**
 * Apply a custom event to its session (pure, so it is testable).
 *
 * A custom event is an interaction, so the visit it belongs to is no longer a
 * bounce and lasts at least until the event. Plausible clears `is_bounce` on
 * any interactive non-pageview event and sets duration to the event's time;
 * Umami counts a bounce only when a visit has one pageview and no custom
 * event. Here the session's `events` counter (pageviews plus custom events)
 * carries that: a bounce is a session with `events = 1`. Rows from before
 * custom events touched the session have `events = page_views`, so the
 * definition is unchanged for them.
 */
export const applyCustomEvent = (row: SessionData, eventTime: number): SessionData => {
  const endTime = Math.max(row.endTime, eventTime);
  return {
    ...row,
    endTime,
    durationSeconds: Math.max(0, endTime - row.startTime),
    events: row.events + 1,
  };
};

/** The full row as the domain type; every column, so a re-insert loses nothing. */
export const sessionRowToData = (existing: SessionRow): SessionData => ({
  sessionId: existing.session_id,
  websiteId: existing.website_id,
  userId: existing.user_id,
  startTime: existing.start_time,
  endTime: existing.end_time,
  durationSeconds: Number(existing.duration_seconds),
  entryPage: existing.entry_page,
  exitPage: existing.exit_page,
  pageViews: Number(existing.page_views),
  events: Number(existing.events),
  engagedSeconds: Number(existing.engaged_seconds ?? 0),
  scrollDepth: Number(existing.scroll_depth ?? 0),
  hostname: existing.hostname,
  browserFamily: existing.browser_family,
  browserVersion: existing.browser_version,
  osFamily: existing.os_family,
  osVersion: existing.os_version,
  deviceType: existing.device_type,
  deviceBrand: existing.device_brand,
  screen: existing.screen ?? "",
  language: existing.language ?? "",
  country: existing.country,
  subdivision1: existing.sub_division_1 ?? "",
  subdivision2: existing.sub_division_2 ?? "",
  city: existing.city,
  channel: existing.channel ?? "",
  referrerDomain: existing.referrer_domain ?? "",
  utmSource: existing.utm_source ?? "",
  utmMedium: existing.utm_medium ?? "",
  utmCampaign: existing.utm_campaign ?? "",
  utmContent: existing.utm_content ?? "",
  utmTerm: existing.utm_term ?? "",
});

/**
 * Record a custom event against its session. Without a session (the event
 * arrived before its pageview, or that pageview was filtered) nothing is
 * written here: the event row itself is already stored, and a session is
 * only ever created by a pageview so views per visit stays meaningful.
 */
export const touchSessionForEvent = async (clickhouse: ClickHouseClient, event: EventData): Promise<boolean> => {
  const existing = await getSession(clickhouse, event.websiteId, event.sessionId);
  if (!existing) return false;
  await upsertSession(clickhouse, applyCustomEvent(sessionRowToData(existing), toUnixSeconds(event.timestamp)));
  return true;
};

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
      engagedSeconds: Number(existingSession.engaged_seconds ?? 0),
      scrollDepth: Number(existingSession.scroll_depth ?? 0),
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
    engagedSeconds: 0,
    scrollDepth: 0,
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
