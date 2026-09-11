import { clickhouse } from "../lib/clickhouse.js";
import { redis } from "../lib/redis.js";
import { detectScriptedClusters } from "../core/bots/clusters.js";

export async function detectScriptedTrafficJob(): Promise<void> {
  const flagged = await detectScriptedClusters({ clickhouse, redis });
  if (flagged > 0) console.log(`[cron] detect-scripted-traffic: ${flagged} cluster(s) flagged`);
}
