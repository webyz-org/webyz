import crypto from "node:crypto";

/**
 * Proof that a visitor typed a shared dashboard's password.
 *
 * The public dashboard is read through the same `/:siteId/...` endpoints the
 * owner uses, so a password-protected share needs something the browser can
 * present on every call. This is an HMAC over the site id and an expiry,
 * keyed by the site's own password hash: the hash never leaves the server, it
 * is stable until the password changes, and changing or removing the password
 * invalidates every token at once. No extra secret to configure, nothing
 * stored per token.
 *
 * Tokens travel in the `X-Share-Token` header (see site-access.plugin.ts).
 */

export const SHARE_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const sign = (secret: string, payload: string) =>
  crypto.createHmac("sha256", secret).update(payload).digest("base64url");

export const issueShareToken = (siteId: string, passwordHash: string): string => {
  const expires = Math.floor(Date.now() / 1000) + SHARE_TOKEN_TTL_SECONDS;
  const payload = `${siteId}.${expires}`;
  return `${expires}.${sign(passwordHash, payload)}`;
};

export const verifyShareToken = (
  siteId: string,
  passwordHash: string,
  token: string | undefined,
): boolean => {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;

  const expires = Number(token.slice(0, dot));
  if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000)) return false;

  const expected = sign(passwordHash, `${siteId}.${expires}`);
  const given = token.slice(dot + 1);
  if (expected.length !== given.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
};
