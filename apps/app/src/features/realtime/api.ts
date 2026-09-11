import { get, API_PREFIX } from "../../lib/axios";
import { API_BASE_URL } from "../../config/env";
import type { RealtimeActivityRow, RealtimeSnapshot } from "./types";

export const getRealtimeSnapshot = (siteId: string, window: number) =>
  get<RealtimeSnapshot>(`/${siteId}/realtime/visitors`, { window });

export const getVisitorActivity = (
  siteId: string,
  visitorId: string,
  window: number,
) =>
  get<RealtimeActivityRow[]>(
    `/${siteId}/realtime/visitors/${visitorId}/activity`,
    { window },
  );

/** SSE endpoint; consumed with EventSource, not axios. */
export const realtimeStreamUrl = (siteId: string) =>
  `${API_BASE_URL}${API_PREFIX}/${siteId}/realtime/stream`;
