import { ClickHouseClient } from "@clickhouse/client";
import type { Redis } from "ioredis";

import { PrismaClient } from "../generated/prisma/client.js";

export type AppContext = {
  clickhouse: ClickHouseClient;
  prisma: PrismaClient;
  redis: Redis;
};
