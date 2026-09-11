import crypto from "node:crypto";

import type { AppContext } from "../../lib/context.js";
import { APP_URL, EMAIL_VERIFICATION_REQUIRED, EMAIL_VERIFICATION_TTL_HOURS } from "../../config/env.js";
import { badRequest } from "../../errors/http-errors.js";
import { sendEmail } from "../email/email.service.js";
import { verifyEmailEmail } from "../email/templates/index.js";
import { startTrial } from "../billing/trial/trial.service.js";

/**
 * Email confirmation for password signups.
 *
 * Why: the trial is 30 days of Growth with no card, and without confirmation a
 * throwaway address is a free account with funnels, journeys and half a
 * million events. So a password signup gets the Free plan and cannot sign in
 * until the link in its email is opened; the trial starts at that moment.
 * Google signups are verified on creation because Google vouches for the
 * address.
 *
 * Whether any of this applies is `EMAIL_VERIFICATION` (config/env.ts):
 * required when a mail provider is configured, off otherwise, unless set
 * explicitly. Every function takes `required` so tests can exercise both.
 *
 * Tokens follow the password-reset rules: only the SHA-256 is stored, one live
 * token per user, single use, and the resend endpoint always resolves so it
 * cannot be used to discover which addresses have accounts.
 */

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export const verificationRequired = (): boolean => EMAIL_VERIFICATION_REQUIRED;

/** Create a fresh token for the user, retire older ones, and send the email. */
export const issueVerification = async (
  { prisma }: Pick<AppContext, "prisma">,
  user: { id: string; email: string; name: string },
  now = new Date(),
): Promise<void> => {
  await prisma.emailVerificationToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: now },
  });

  const token = crypto.randomBytes(32).toString("base64url");
  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_HOURS * 3_600_000),
    },
  });

  await sendEmail(
    verifyEmailEmail(user.email, {
      name: user.name,
      url: `${APP_URL}/verify-email?token=${token}`,
      hours: EMAIL_VERIFICATION_TTL_HOURS,
    }),
  );
};

/**
 * Redeem a link. Marks the address verified, consumes the token, and starts
 * the trial the account was waiting for. Missing, used and expired tokens all
 * fail with the same message.
 */
export const verifyEmail = async (
  ctx: Pick<AppContext, "prisma" | "redis">,
  token: string,
  now = new Date(),
): Promise<{ id: string; email: string; name: string }> => {
  const { prisma } = ctx;
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, usedAt: true, expiresAt: true },
  });

  if (!record || record.usedAt || record.expiresAt.getTime() < now.getTime()) {
    throw badRequest("This confirmation link is invalid or has expired. Request a new one from the sign-in page.");
  }

  const [, user] = await prisma.$transaction([
    prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: now } }),
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: now },
      select: { id: true, email: true, name: true },
    }),
  ]);

  // The trial the signup deferred. startTrial is idempotent through
  // trialUsedAt and returns null when the account is not eligible (already
  // used, or a tombstone from a deleted account), in which case Free stays.
  await startTrial(ctx, user.id, now).catch((err) => {
    console.error(`[verify-email] trial did not start for ${user.id}:`, err);
  });

  return user;
};

/**
 * Send a new link. Resolves whatever the address is: unknown, already
 * verified, or Google-only. Only an unverified password account gets mail.
 */
export const resendVerification = async ({ prisma }: Pick<AppContext, "prisma">, email: string): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true, name: true, emailVerifiedAt: true, password: true },
  });
  if (!user || user.emailVerifiedAt || !user.password) return;
  await issueVerification({ prisma }, user);
};
