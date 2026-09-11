import type { Redis, RedisOptions } from "ioredis";

import { REDIS_HOST, REDIS_PORT } from "../config/env.js";
import { createRedisClient as create } from "./redis-client.js";

/** A client for the configured Redis; see redis-client.ts for why it fails fast. */
export const createRedisClient = (overrides: RedisOptions = {}): Redis =>
  create({ host: REDIS_HOST, port: REDIS_PORT }, overrides);

/** The process-wide client every service shares. */
export const redis: Redis = createRedisClient();

redis.on("connect", () => {
  console.log("Redis connected");
});

redis.on("error", (err: any) => {
  console.error("Redis error:", err?.message ?? err);
});

/**
 * Close the shared client. `quit()` rejects when the connection is not ready
 * (there is no offline queue to park it in), and a rejected quit leaves the
 * socket open, which keeps a process alive; `disconnect()` always drops it.
 */
export const closeRedis = async (): Promise<void> => {
  await redis.quit().catch(() => redis.disconnect());
};
