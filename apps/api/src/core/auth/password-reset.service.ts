import crypto from "node:crypto";

import { AppContext } from "../../lib/context.js";
import {
  APP_URL,
  PASSWORD_RESET_TTL_MINUTES,
} from "../../config/env.js";
import { badRequest } from "../../errors/http-errors.js";
import { hashPassword } from "./password.service.js";
import { revokeAllSessions } from "./sessions.service.js";
import { sendEmail } from "../email/email.service.js";
import {
  passwordChangedEmail,
  passwordResetEmail,
} from "../email/templates/index.js";

/** Tokens are stored hashed, so a database leak yields no usable links. */
const hashToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");

/**
 * Start a password reset.
 *
 * Always resolves, whether or not the address belongs to an account, so this
 * endpoint cannot be used to discover which emails are registered. The caller
 * returns the same response either way.
 */
export const requestPasswordReset = async (
  { prisma }: AppContext,
  email: string,
): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true, password: true },
  });

  if (!user) return;

  if (!user.password) {
    // Google-only account: there is no password to reset, and saying so here
    // would leak which accounts use Google.
    return;
  }

  // Any earlier unused token is retired, so only the newest link works.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = crypto.randomBytes(32).toString("base64url");

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000),
    },
  });

  const resetUrl = `${APP_URL}/reset-password?token=${token}`;

  await sendEmail(
    passwordResetEmail(user.email, resetUrl, PASSWORD_RESET_TTL_MINUTES),
  );
};

/**
 * Complete a password reset.
 *
 * Consumes the token, sets the new password, and revokes every session so an
 * attacker who already had one is cut off.
 */
export const resetPassword = async (
  ctx: AppContext,
  input: { token: string; newPassword: string },
): Promise<void> => {
  const { prisma } = ctx;

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(input.token) },
    include: { user: { select: { id: true, email: true } } },
  });

  // One message for missing, used and expired tokens: the distinction is not
  // useful to a legitimate user and is useful to an attacker.
  const invalid = badRequest("This reset link is invalid or has expired");

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw invalid;
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { password: passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);

  await revokeAllSessions(ctx, record.userId);

  await sendEmail(passwordChangedEmail(record.user.email));
};

/** Housekeeping for the weekly cron: drop spent and expired tokens. */
export const purgeExpiredResetTokens = async ({ prisma }: AppContext) => {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const result = await prisma.passwordResetToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { lt: cutoff } }],
    },
  });

  return result.count;
};
