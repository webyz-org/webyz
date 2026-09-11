import RedisImport, { type Redis, type RedisOptions } from "ioredis";

const RedisCtor = ((RedisImport as any).default || RedisImport) as typeof Redis;

/**
 * Redis is a cache and a coordination point, never the source of truth:
 * sessions, sites, entitlements and API keys fall back to Postgres, visitor
 * identity to deterministic values, the rate limiter to letting requests
 * through, cron to skipping the window. Every one of those fallbacks is a
 * `catch`, so a command must *reject* when Redis is unreachable. ioredis
 * defaults do the opposite: with the offline queue on and no command timeout,
 * a command issued while disconnected waits forever and every request holding
 * one hangs until the proxy gives up. That is an API that stalls, not one
 * that degrades.
 *
 * - `enableOfflineQueue: false`: a command issued while the connection is
 *   down rejects at once instead of queueing, and nothing accumulates for the
 *   length of an outage. Reconnection is separate and still automatic.
 * - `commandTimeout`: a command the server accepted but never answers (a hung
 *   Redis, a black-holed connection) rejects after this long. ioredis arms it
 *   before deciding whether to queue, so it bounds queued commands too where
 *   a caller keeps the queue on (the realtime subscriber).
 * - `maxRetriesPerRequest: null`: reconnect attempts are unlimited; the two
 *   settings above bound each command, so this no longer means "wait forever".
 *
 * `lib/redis.ts` holds the process-wide client built from these options; this
 * module has no side effects so it can be tested against a throwaway port.
 */
export const REDIS_COMMAND_TIMEOUT_MS = 2_000;

export const redisOptions = (
  connection: { host: string; port: number },
  overrides: RedisOptions = {},
): RedisOptions => ({
  host: connection.host,
  port: connection.port,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  enableOfflineQueue: false,
  commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
  ...overrides,
});

export const createRedisClient = (
  connection: { host: string; port: number },
  overrides: RedisOptions = {},
): Redis => new RedisCtor(redisOptions(connection, overrides));
