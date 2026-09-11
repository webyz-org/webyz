import { AppContext } from "../../lib/context.js";
import { badRequest, notFound } from "../../errors/http-errors.js";
import { sharePasswordInvalid } from "../../errors/domain-errors.js";
import { hashPassword, verifyPassword } from "../auth/password.service.js";
import { SHARE_TOKEN_TTL_SECONDS, issueShareToken } from "./share-token.js";
import { getManagedWebsite } from "./website.service.js";

/**
 * A password in front of a shared dashboard.
 *
 * The password is stored as a bcrypt hash on the site row and never read
 * back. A visitor who types it right gets a share token (share-token.ts),
 * which the site-access plugin checks on every analytics read. Changing or
 * removing the password rewrites the hash, and with it every outstanding
 * token stops verifying, so there is nothing to revoke.
 */

export const SHARE_PASSWORD_MIN_LENGTH = 8;
export const SHARE_PASSWORD_MAX_LENGTH = 128;

/** The route schema enforces this too; the service repeats it so a caller cannot skip it. */
export const assertSharePasswordShape = (password: string) => {
  if (
    typeof password !== "string" ||
    password.length < SHARE_PASSWORD_MIN_LENGTH ||
    password.length > SHARE_PASSWORD_MAX_LENGTH
  ) {
    throw badRequest(
      `The password must be between ${SHARE_PASSWORD_MIN_LENGTH} and ${SHARE_PASSWORD_MAX_LENGTH} characters`,
    );
  }
};

/** Set or replace the password. Sharing must already be on: a password guards a link. */
export const setSharePassword = async (
  ctx: AppContext,
  userId: string,
  siteId: string,
  password: string,
) => {
  assertSharePasswordShape(password);
  const website = await getManagedWebsite(ctx, userId, siteId);
  if (!website.isPublic) throw badRequest("Turn on sharing before setting a password");

  const sharePasswordHash = await hashPassword(password);
  return ctx.prisma.website.update({
    where: { id: siteId },
    data: { sharePasswordHash },
  });
};

/** Remove the password; the link becomes open to anyone who has it again. */
export const clearSharePassword = async (
  ctx: AppContext,
  userId: string,
  siteId: string,
) => {
  const website = await getManagedWebsite(ctx, userId, siteId);
  if (!website.isPublic) throw badRequest("This dashboard is not shared");

  return ctx.prisma.website.update({
    where: { id: siteId },
    data: { sharePasswordHash: null },
  });
};

/** What the unlock endpoint needs from the site row. */
export type UnlockTarget = {
  id: string;
  sharePasswordHash: string | null;
};

export type UnlockResult = { token: string; expiresIn: number };

/**
 * Exchange a typed password for a share token. Pure apart from bcrypt, so it
 * is testable without a database; the controller resolves the slug first.
 */
export const unlockWithPassword = async (
  site: UnlockTarget | null,
  password: string,
  verify: (plain: string, hash: string) => Promise<boolean> = verifyPassword,
): Promise<UnlockResult> => {
  if (!site) throw notFound("Shared dashboard not found");
  if (!site.sharePasswordHash) throw badRequest("This dashboard has no password");

  const ok = typeof password === "string" && (await verify(password, site.sharePasswordHash));
  if (!ok) throw sharePasswordInvalid();

  return {
    token: issueShareToken(site.id, site.sharePasswordHash),
    expiresIn: SHARE_TOKEN_TTL_SECONDS,
  };
};

/** Resolve a public slug and unlock it. */
export const unlockSharedWebsite = async (
  { prisma }: AppContext,
  slug: string,
  password: string,
): Promise<UnlockResult> => {
  const site = await prisma.website.findFirst({
    where: { publicSlug: slug, isPublic: true },
    select: { id: true, sharePasswordHash: true },
  });
  return unlockWithPassword(site, password);
};
