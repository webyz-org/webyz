import { runEmailReports } from "../core/notifications/email-reports.service.js";
import { clickhouse } from "../lib/clickhouse.js";
import prisma from "../lib/prisma.js";
import { redis } from "../lib/redis.js";

/** Hourly: send every weekly or monthly report whose period is complete and due. */
export async function emailReportsJob() {
  console.log("[cron] email reports job");
  const result = await runEmailReports({ prisma, clickhouse, redis }, new Date());
  console.log(
    `[email-reports] ${result.reports} report(s): ${result.sent} email(s) sent, ${result.skipped} skipped, ${result.failed} failed`,
  );
}
