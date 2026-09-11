import fp from "fastify-plugin";

import { clickhouse } from "../../lib/clickhouse.js";

export default fp(async (fastify) => {
  fastify.decorate("clickhouse", clickhouse);

  fastify.addHook("onClose", async () => {
    await clickhouse.close().catch(() => {});
  });
});
