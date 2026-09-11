import type { Redis } from "ioredis";

/**
 * Serialises writes to one session row.
 *
 * The sessions table is a ReplacingMergeTree, so every write is read the row,
 * change it, insert the whole row again. Two writes for the same session in
 * flight together both read the same old row and the later insert silently
 * discards the earlier change: a route change in a single-page app sends
 * the previous page's engagement report and the next pageview within
 * milliseconds of each other, and without a lock the scroll depth or the
 * pageview count was lost depending on which landed last. Plausible locks
 * per session for the same reason (its `lock_timeout` drop).
 *
 * The lock is a Redis key with a short TTL. When Redis is unavailable, or the
 * lock is still held after the wait, the write proceeds anyway: a rare lost
 * update is better than a dropped event, and both are better than an ingest
 * that stalls on Redis.
 */
const LOCK_TTL_MS = 2_000;
const RETRY_MS = 20;
const MAX_WAIT_MS = 600;

export type LockRedis = Pick<Redis, "set" | "del">;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const withSessionLock = async <T>(
  redis: LockRedis | undefined,
  websiteId: string,
  sessionId: string,
  fn: () => Promise<T>,
): Promise<T> => {
  if (!redis) return fn();

  const key = `session:lock:${websiteId}:${sessionId}`;
  const token = `${process.pid}:${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + MAX_WAIT_MS;
  let held = false;

  while (Date.now() < deadline) {
    const acquired = await redis.set(key, token, "PX", LOCK_TTL_MS, "NX").catch(() => "ERR");
    if (acquired === "OK") {
      held = true;
      break;
    }
    if (acquired === "ERR") break; // Redis down: proceed unlocked.
    await sleep(RETRY_MS);
  }

  try {
    return await fn();
  } finally {
    // Best effort; the TTL covers a crash between acquire and release.
    if (held) await redis.del(key).catch(() => null);
  }
};
