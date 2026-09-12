import { FastifyRequest } from "fastify";
import { eventTimestamp } from "./timestamp.js";

import { TrackingPayload } from "../types.js";
import { extractClientInfoFromRequest } from "../http/extract-client-info.js";
import { extractHostname } from "../../utils/hostname.js";
import { isBot } from "../../utils/bot-detection.js";
import { isDatacenterIp } from "../../core/bots/datacenter-ips.js";
import { isSpamReferrer } from "../../core/bots/referrer-spam.js";
import { clusterFilterApplies, isFlaggedCluster } from "../../core/bots/clusters.js";
import { recordDrop, type DropReason } from "../../core/bots/drops.js";
import { BOT_CLUSTER_FILTER, BOT_DATACENTER_FILTER } from "../../config/env.js";
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

  // Bot traffic is dropped silently: a raw throw here became a 500 (and
  // broke the GET pixel response), and a crawler is not a client that needs
  // an error. Four filters, cheapest first: what the client says it is
  // (utils/bot-detection.ts), where it connects from (core/bots/
  // datacenter-ips.ts), who it claims sent it (core/bots/referrer-spam.ts)
  // and whether it belongs to a group already found to behave like a script
  // (core/bots/clusters.ts). Each drop is counted per site and reason in
  // ClickHouse, never with the address or user agent, so the dashboard can
  // show what was filtered.
  const drop = (reason: DropReason) => {
    request.log.debug({ siteId: payload.sid, reason }, "event dropped");
    recordDrop(request.ctx.clickhouse, payload.sid, reason);
    return null;
  };

  if (isBot(clientInfo.userAgent)) return drop("bot_user_agent");
  if (BOT_DATACENTER_FILTER && (await isDatacenterIp(clientInfo.ip))) return drop("datacenter_ip");

  const url = normalizeUrlData(payload?.url, payload?.ref, hostname);
  if (url.referrerDomain && (await isSpamReferrer(url.referrerDomain))) return drop("referrer_spam");

  if (
    BOT_CLUSTER_FILTER &&
    clusterFilterApplies(payload.t, payload.screen || "", payload.lang || "") &&
    (await isFlaggedCluster(
      request.ctx.redis,
      payload.sid,
      payload.screen || "",
      uaInfo.browserFamily,
      payload.lang || "",
    ))
  ) {
    return drop("scripted_cluster");
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
        payload.t === "event" ? payload.name || "custom_event" : payload.t,
      engagement:
        payload.t === "engagement"
          ? {
              ms: Math.max(0, Math.min(86_400_000, Math.round(Number(payload.e) || 0))),
              scrollDepth: Math.max(0, Math.min(100, Math.round(Number(payload.sd) || 0))),
            }
          : undefined,
      timestamp,
      hostname,
      url,
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
