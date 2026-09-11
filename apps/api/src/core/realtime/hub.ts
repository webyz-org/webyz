import type { Redis } from "ioredis";

import { createRedisClient } from "../../lib/redis.js";

type Listener = (message: string) => void;

/**
 * One Redis SUBSCRIBE connection for the whole process, shared by every open
 * SSE stream. A subscribed ioredis connection cannot run normal commands, so
 * this is a dedicated connection, created lazily on the first stream and kept
 * for the life of the process. Channels are refcounted: several dashboard
 * tabs watching the same site share a single Redis subscription.
 */
const listeners = new Map<string, Set<Listener>>();
let subscriber: Redis | null = null;

const getSubscriber = () => {
  if (subscriber) return subscriber;

  // Unlike the shared client this one keeps the offline queue: a SUBSCRIBE
  // issued while Redis is down must be sent once it is back, or the channel
  // is never joined. The command timeout still bounds each call.
  subscriber = createRedisClient({ enableOfflineQueue: true });

  subscriber.on("error", (err: any) => {
    console.error("[realtime-hub] Redis error:", err?.message ?? err);
  });

  // ioredis resubscribes to all channels itself after a reconnect.
  subscriber.on("message", (channel: string, message: string) => {
    const set = listeners.get(channel);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(message);
      } catch {
        // One broken stream must not take down the others.
      }
    }
  });

  return subscriber;
};

/** Subscribe a listener to a channel. Returns the matching unsubscribe. */
export const subscribeRealtime = (
  channel: string,
  listener: Listener,
): (() => void) => {
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
    getSubscriber().subscribe(channel).catch(() => {});
  }
  set.add(listener);

  return () => {
    const current = listeners.get(channel);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listeners.delete(channel);
      subscriber?.unsubscribe(channel).catch(() => {});
    }
  };
};
