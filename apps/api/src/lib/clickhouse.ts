import { createClient } from "@clickhouse/client";

import {
  CLICKHOUSE_DB,
  CLICKHOUSE_PASSWORD,
  CLICKHOUSE_URL,
  CLICKHOUSE_USER,
} from "../config/env.js";

export const clickhouse = createClient({
  url: CLICKHOUSE_URL,
  username: CLICKHOUSE_USER,
  password: CLICKHOUSE_PASSWORD,
  database: CLICKHOUSE_DB,
});
