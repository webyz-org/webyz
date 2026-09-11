import { redis } from "../../lib/redis.js";
import { EventData } from "../tracker/types.js";

/**
 * Live activity fan-out for the Realtime page.
 *
 * After an event is written to ClickHouse, a compact copy is PUBLISHed to a
 * per-site Redis channel. SSE connections subscribe (via the hub) and forward
 * it to open dashboards. Nothing is stored: Redis pub/sub has no retention,
 * ClickHouse remains the source of truth, and a dashboard that connects late
 * reconciles from the snapshot endpoint.
 *
 * The payload carries only what the dashboard renders - no IP, no user agent,
 * no query strings.
 */

export const realtimeChannel = (websiteId: string) => `rt:site:${websiteId}`;

export type RealtimeStreamEvent = {
  type: "pageview" | "event";
  visitorId: string;
  sessionId: string;
  ts: number;
  path: string;
  /** Custom event name; empty for pageviews. */
  name: string;
  country: string;
  region: string;
  city: string;
  browser: string;
  os: string;
  device: string;
};

/** Fire-and-forget: a Redis hiccup must never fail ingest. */
export const publishRealtimeEvent = (event: EventData) => {
  const payload: RealtimeStreamEvent = {
    type: event.eventType === "pageview" ? "pageview" : "event",
    visitorId: event.userId,
    sessionId: event.sessionId,
    ts: Math.floor(new Date(event.timestamp).getTime() / 1000),
    path: event.urlPath,
    name: event.eventType === "pageview" ? "" : event.eventName,
    country: event.country,
    region: event.subdivision1,
    city: event.city,
    browser: event.browser,
    os: event.os,
    device: event.deviceType,
  };

  redis
    .publish(realtimeChannel(event.websiteId), JSON.stringify(payload))
    .catch(() => {});
};
