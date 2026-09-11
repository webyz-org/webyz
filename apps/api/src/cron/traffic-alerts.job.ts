import { runTrafficAlerts } from "../core/notifications/traffic-alerts.service.js";
import { clickhouse } from "../lib/clickhouse.js";
import prisma from "../lib/prisma.js";
import { redis } from "../lib/redis.js";

/** Every five minutes: alert on sites whose live visitor count crossed the threshold. */
export async function trafficAlertsJob() {
  const result = await runTrafficAlerts({ prisma, clickhouse, redis }, new Date());
  if (result.triggered || result.failed) {
    console.log(`[traffic-alerts] ${result.triggered} triggered, ${result.sent} email(s) sent, ${result.failed} failed`);
  }
}
