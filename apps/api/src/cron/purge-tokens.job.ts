import { purgeExpiredResetTokens } from "../core/auth/password-reset.service.js";
import { cleanupExpiredSessions } from "../core/auth/sessions.service.js";
import { purgeExpiredInvitations } from "../core/website/members.service.js";
import { clickhouse } from "../lib/clickhouse.js";
import prisma from "../lib/prisma.js";
import { redis } from "../lib/redis.js";

/** Housekeeping: expired sessions and spent password reset tokens. */
export async function purgeTokensJob() {
  const ctx = { prisma, clickhouse, redis };

  const sessions = await cleanupExpiredSessions(ctx);
  const tokens = await purgeExpiredResetTokens(ctx);
  const invitations = await purgeExpiredInvitations(ctx);

  console.log(
    `[cron] purge: removed ${sessions} expired session(s), ${tokens} reset token(s), ${invitations} expired invitation(s)`,
  );
}
