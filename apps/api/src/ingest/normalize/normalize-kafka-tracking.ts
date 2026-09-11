import type { Redis } from "ioredis";
import { eventTimestamp } from "./timestamp.js";

import { normalizeGeo } from "../../core/geo/index.js";
import { identifyVisitor } from "../identity/visitor-identity.js";
import { isBot } from "../../utils/bot-detection.js";
import { extractHostname } from "../../utils/hostname.js";
import { normalizeMeta } from "../helpers/meta.js";
import { normalizeUrlData } from "../helpers/url.js";
import { normalizeUtm } from "../helpers/utm.js";
import { TrackingPayload } from "../types.js";
import { parseUserAgent } from "../user-agent/parse-user-agent.js";

export type KafkaTrackingMessage = {
  payload: TrackingPayload;
  /** When the API received the request; the event's time. Absent on messages from older producers. */
  receivedAt?: string;
  headers?: Record<string, string>;
  ip?: string;
};

export const normalizeKafkaTracking = async (
  message: KafkaTrackingMessage,
  deps: { redis: Redis },
) => {
  const userAgent = message.headers?.["user-agent"] ?? "";
  if (isBot(userAgent)) return null;

  const ip = message.ip ?? "0.0.0.0";
  // Same cookieless identity as the HTTP path; the producer forwards the
  // headers this needs. Payload vid/ssid from old scripts are ignored.
  const identity = await identifyVisitor(deps.redis, {
    websiteId: message.payload.sid,
    ip,
    userAgent,
  });

  const uaInfo = parseUserAgent(userAgent);
  const hostname = extractHostname(message.payload.url, {
    headers: message.headers,
  } as any);

  // The API's receive time, never the client's claim; a message from an older
  // producer without it gets the consumer's clock, which is still the server's.
  const received = message.receivedAt ? new Date(message.receivedAt) : new Date();
  const timestamp = eventTimestamp(message.payload.ts, Number.isNaN(received.getTime()) ? new Date() : received);

  return {
    input: {
      websiteId: message.payload.sid,
      sessionId: identity.sessionId,
      userId: identity.visitorId,
      eventType: message.payload.t,
      eventName:
        message.payload.t === "event"
          ? message.payload.name || "custom_event"
          : "pageview",
      timestamp,
      hostname,
      url: normalizeUrlData(
        message.payload?.url,
        message.payload?.ref,
        hostname,
      ),
      utm: normalizeUtm(message.payload?.url, hostname),
      geo: await normalizeGeo(ip),
      meta: normalizeMeta(message.payload),
      client: { deviceType: uaInfo.deviceType, ip },
      page: {
        title: message.payload.title || "",
        screen: message.payload.screen || "",
        language: message.payload.lang || "",
      },
      userAgent: uaInfo as any,
    },
    uaInfo,
    isPageView: message.payload.t === "pageview",
    newSession: identity.isNewSession,
  };
};
