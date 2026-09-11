/** One visitor seen inside the realtime window (API row, snake_case). */
export type RealtimeVisitorRow = {
  visitor_id: string;
  session_id: string;
  last_active: number;
  first_seen: number;
  country: string;
  region: string;
  city: string;
  browser: string;
  os: string;
  device: string;
  current_path: string;
  pageviews: number;
  events: number;
  referrer_domain: string;
  channel: string;
};

export type RealtimeActivityRow = {
  ts: number;
  visitor_id: string;
  event_type: string;
  event_name: string;
  path: string;
  country: string;
};

export type RealtimeSnapshot = {
  window_minutes: number;
  active_minutes: number;
  active_visitors: number;
  window_visitors: number;
  pageviews: number;
  events: number;
  countries: number;
  visitors: RealtimeVisitorRow[];
  recent_activity: RealtimeActivityRow[];
};

/** One SSE message from /realtime/stream (mirrors the API publisher). */
export type RealtimeStreamEvent = {
  type: "pageview" | "event";
  visitorId: string;
  sessionId: string;
  ts: number;
  path: string;
  name: string;
  country: string;
  region: string;
  city: string;
  browser: string;
  os: string;
  device: string;
};

/** Normalized client-side visitor state. */
export type Visitor = {
  visitorId: string;
  sessionId: string;
  lastActiveAt: number;
  firstSeenAt: number;
  country: string;
  region: string;
  city: string;
  browser: string;
  os: string;
  device: string;
  currentPath: string;
  pageviews: number;
  events: number;
  referrerDomain: string;
  channel: string;
};

export type ActivityItem = {
  ts: number;
  visitorId: string;
  kind: "pageview" | "event";
  name: string;
  path: string;
  country: string;
};

export type ConnectionStatus = "connecting" | "live" | "reconnecting";

export type RealtimeWindow = 5 | 15 | 30;
export const REALTIME_WINDOWS: RealtimeWindow[] = [5, 15, 30];
export const DEFAULT_REALTIME_WINDOW: RealtimeWindow = 30;
