import { useEffect, useReducer, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getRealtimeSnapshot, realtimeStreamUrl } from "./api";
import type {
  ActivityItem,
  ConnectionStatus,
  RealtimeSnapshot,
  RealtimeStreamEvent,
  RealtimeWindow,
  Visitor,
} from "./types";

/**
 * Realtime page state: snapshot first, then SSE increments.
 *
 * 1. The snapshot endpoint renders the initial view.
 * 2. An EventSource delivers per-event increments, which are buffered and
 *    applied in one dispatch every FLUSH_MS - high-traffic sites update the
 *    UI a few times per second at most, never once per event.
 * 3. EventSource reconnects by itself; after a drop the snapshot is refetched
 *    so anything missed while disconnected is reconciled.
 * 4. Pause keeps the stream connected and buffering but stops applying to the
 *    UI; resume flushes the buffer and refetches the snapshot.
 * 5. A sweep tick drops visitors that have aged out of the window, so nobody
 *    stays "online" forever, and one missed beat never removes anyone early.
 */

const FLUSH_MS = 2000;
const TICK_MS = 10_000;
const FEED_LIMIT = 30;

type State = {
  visitorsById: Record<string, Visitor>;
  feed: ActivityItem[];
  pageviews: number;
  events: number;
  lastUpdatedAt: number | null;
};

const initialState: State = {
  visitorsById: {},
  feed: [],
  pageviews: 0,
  events: 0,
  lastUpdatedAt: null,
};

type Action =
  | { type: "seed"; snapshot: RealtimeSnapshot }
  | { type: "apply"; events: RealtimeStreamEvent[] }
  | { type: "sweep"; windowMinutes: number };

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "seed": {
      const visitorsById: Record<string, Visitor> = {};
      for (const row of action.snapshot.visitors) {
        visitorsById[row.visitor_id] = {
          visitorId: row.visitor_id,
          sessionId: row.session_id,
          lastActiveAt: row.last_active,
          firstSeenAt: row.first_seen,
          country: row.country,
          region: row.region,
          city: row.city,
          browser: row.browser,
          os: row.os,
          device: row.device,
          currentPath: row.current_path,
          pageviews: row.pageviews,
          events: row.events,
          referrerDomain: row.referrer_domain,
          channel: row.channel,
        };
      }
      const feed: ActivityItem[] = action.snapshot.recent_activity.map((row) => ({
        ts: row.ts,
        visitorId: row.visitor_id,
        kind: row.event_type === "pageview" ? "pageview" : "event",
        name: row.event_name === "pageview" ? "" : row.event_name,
        path: row.path,
        country: row.country,
      }));
      return {
        visitorsById,
        feed,
        pageviews: action.snapshot.pageviews,
        events: action.snapshot.events,
        lastUpdatedAt: Math.floor(Date.now() / 1000),
      };
    }

    case "apply": {
      if (action.events.length === 0) return state;
      const visitorsById = { ...state.visitorsById };
      let feed = state.feed;
      let pageviews = state.pageviews;
      let events = state.events;

      for (const ev of action.events) {
        if (!ev || typeof ev.visitorId !== "string") continue; // malformed
        const prev = visitorsById[ev.visitorId];
        visitorsById[ev.visitorId] = {
          visitorId: ev.visitorId,
          sessionId: ev.sessionId,
          lastActiveAt: Math.max(ev.ts, prev?.lastActiveAt ?? 0),
          firstSeenAt: prev?.firstSeenAt ?? ev.ts,
          country: ev.country || prev?.country || "",
          region: ev.region || prev?.region || "",
          city: ev.city || prev?.city || "",
          browser: ev.browser || prev?.browser || "",
          os: ev.os || prev?.os || "",
          device: ev.device || prev?.device || "",
          currentPath:
            ev.type === "pageview" ? ev.path : (prev?.currentPath ?? ev.path),
          pageviews: (prev?.pageviews ?? 0) + (ev.type === "pageview" ? 1 : 0),
          events: (prev?.events ?? 0) + (ev.type === "event" ? 1 : 0),
          referrerDomain: prev?.referrerDomain ?? "",
          channel: prev?.channel ?? "",
        };
        if (ev.type === "pageview") pageviews += 1;
        else events += 1;
        feed = [
          {
            ts: ev.ts,
            visitorId: ev.visitorId,
            kind: ev.type,
            name: ev.name,
            path: ev.path,
            country: ev.country,
          },
          ...feed,
        ];
      }

      return {
        visitorsById,
        feed: feed.slice(0, FEED_LIMIT),
        pageviews,
        events,
        lastUpdatedAt: Math.floor(Date.now() / 1000),
      };
    }

    case "sweep": {
      const cutoff = Math.floor(Date.now() / 1000) - action.windowMinutes * 60;
      const stale = Object.values(state.visitorsById).filter(
        (v) => v.lastActiveAt < cutoff,
      );
      if (stale.length === 0) return state;
      const visitorsById = { ...state.visitorsById };
      for (const v of stale) delete visitorsById[v.visitorId];
      return { ...state, visitorsById };
    }
  }
};

export function useRealtimeFeed(
  siteId: string | undefined,
  windowMinutes: RealtimeWindow,
) {
  const queryClient = useQueryClient();

  const snapshot = useQuery({
    queryKey: ["realtime-page", siteId, windowMinutes],
    queryFn: () => getRealtimeSnapshot(siteId!, windowMinutes),
    enabled: Boolean(siteId),
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  const [state, dispatch] = useReducer(reducer, initialState);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const bufferRef = useRef<RealtimeStreamEvent[]>([]);
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (snapshot.data) dispatch({ type: "seed", snapshot: snapshot.data });
  }, [snapshot.data]);

  useEffect(() => {
    if (!siteId) return;

    const source = new EventSource(realtimeStreamUrl(siteId), {
      withCredentials: true,
    });
    let droppedOnce = false;

    source.onopen = () => {
      setStatus("live");
      if (droppedOnce) {
        droppedOnce = false;
        // Reconcile whatever happened while the connection was down.
        queryClient.invalidateQueries({ queryKey: ["realtime-page", siteId] });
      }
    };
    source.onerror = () => {
      droppedOnce = true;
      setStatus("reconnecting");
    };
    source.onmessage = (message) => {
      try {
        bufferRef.current.push(JSON.parse(message.data));
      } catch {
        // Malformed frame: ignore, the next snapshot reconciles.
      }
    };

    const flush = setInterval(() => {
      if (pausedRef.current || bufferRef.current.length === 0) return;
      const batch = bufferRef.current;
      bufferRef.current = [];
      dispatch({ type: "apply", events: batch });
    }, FLUSH_MS);

    return () => {
      clearInterval(flush);
      source.close();
    };
  }, [siteId, queryClient]);

  // Clock for relative labels and lifecycle sweep. One interval, not per row.
  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
      dispatch({ type: "sweep", windowMinutes });
    }, TICK_MS);
    return () => clearInterval(tick);
  }, [windowMinutes]);

  const resume = () => {
    setPaused(false);
    const batch = bufferRef.current;
    bufferRef.current = [];
    if (batch.length) dispatch({ type: "apply", events: batch });
    snapshot.refetch();
  };

  const activeMinutes = snapshot.data?.active_minutes ?? 5;
  const activeCutoff = now - activeMinutes * 60;

  // Most recent activity first; visitorId as tiebreak keeps the order stable
  // so the list does not shuffle rows that share a timestamp.
  const visitors = Object.values(state.visitorsById).sort(
    (a, b) =>
      b.lastActiveAt - a.lastActiveAt ||
      a.visitorId.localeCompare(b.visitorId),
  );

  const activeCount = visitors.filter(
    (v) => v.lastActiveAt >= activeCutoff,
  ).length;

  const countryCounts = new Map<
    string,
    { count: number; active: boolean; lastActiveAt: number }
  >();
  for (const v of visitors) {
    if (!v.country) continue;
    const entry = countryCounts.get(v.country) ?? {
      count: 0,
      active: false,
      lastActiveAt: 0,
    };
    entry.count += 1;
    entry.active = entry.active || v.lastActiveAt >= activeCutoff;
    entry.lastActiveAt = Math.max(entry.lastActiveAt, v.lastActiveAt);
    countryCounts.set(v.country, entry);
  }

  return {
    visitors,
    visitorsById: state.visitorsById,
    feed: state.feed,
    pageviews: state.pageviews,
    events: state.events,
    countryCounts,
    activeCount,
    activeMinutes,
    now,
    lastUpdatedAt: state.lastUpdatedAt,
    status,
    paused,
    pause: () => setPaused(true),
    resume,
    isLoading: snapshot.isLoading,
    isError: snapshot.isError,
  };
}
