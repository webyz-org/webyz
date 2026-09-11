import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

import { closeRedis, redis } from "../../lib/redis.js";

export default fp(async (fastify: FastifyInstance) => {
  fastify.decorate("redis", redis);
  fastify.addHook("onClose", async () => {
    await closeRedis();
  });
});
