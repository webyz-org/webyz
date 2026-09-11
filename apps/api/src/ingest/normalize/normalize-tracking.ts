import { FastifyRequest } from "fastify";
import { eventTimestamp } from "./timestamp.js";

import { TrackingPayload } from "../types.js";
import { extractClientInfoFromRequest } from "../http/extract-client-info.js";
import { extractHostname } from "../../utils/hostname.js";
import { isBot } from "../../utils/bot-detection.js";
import { normalizeUtm } from "../helpers/utm.js";
import { normalizeMeta } from "../helpers/meta.js";
import { normalizeUrlData } from "../helpers/url.js";
import { parseUserAgent } from "../user-agent/parse-user-agent.js";
import { normalizeGeo } from "../../core/geo/index.js";
import { identifyVisitor } from "../identity/visitor-identity.js";

export const normalizeTracking = async (
  payload: TrackingPayload,
  request: FastifyRequest,
) => {
  // Extract client information
  const clientInfo = extractClientInfoFromRequest(request);
  const uaInfo = parseUserAgent(clientInfo.userAgent);
  const hostname = extractHostname(payload.url, request);

  // Bot traffic is dropped silently, mirroring normalize-kafka-tracking: a
  // raw throw here became a 500 (and broke the GET pixel response), and a
  // crawler is not a client that needs an error.
  if (isBot(clientInfo.userAgent)) {
    return null;
  }

  // Server time, not the client's claim. See normalize/timestamp.ts.
  const timestamp = eventTimestamp(payload.ts, new Date());

  // Visitor and session are derived here, never read from the payload: the
  // tracker is cookieless and any vid/ssid an old script still sends is
  // ignored. See ingest/identity/visitor-identity.ts.
  const identity = await identifyVisitor(request.ctx.redis, {
    websiteId: payload.sid,
    ip: clientInfo.ip,
    userAgent: clientInfo.userAgent,
  });

  return {
    input: {
      websiteId: payload.sid,
      sessionId: identity.sessionId,
      userId: identity.visitorId,
      eventType: payload.t,
      eventName:
        payload.t === "event" ? payload.name || "custom_event" : "pageview",
      timestamp,
      hostname,
      url: normalizeUrlData(payload?.url, payload?.ref, hostname),
      utm: normalizeUtm(payload?.url, hostname),
      geo: await normalizeGeo(clientInfo.ip),
      meta: normalizeMeta(payload),
      client: { ip: clientInfo.ip, deviceType: clientInfo.deviceType },
      page: {
        title: payload.title || "",
        screen: payload.screen || "",
        language: payload.lang || "",
      },
      userAgent: { browser: clientInfo.browser, os: clientInfo.os },
    },
    uaInfo,
    isPageView: payload.t === "pageview",
    newSession: identity.isNewSession,
  };
};
