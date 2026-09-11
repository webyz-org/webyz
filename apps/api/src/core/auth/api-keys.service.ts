import crypto from "node:crypto";

import type { AppContext } from "../../lib/context.js";
import { notFound } from "../../errors/http-errors.js";
import { tooManyApiKeys } from "../../errors/domain-errors.js";
import { assertFeature } from "../billing/entitlements/entitlement.guard.js";

/**
 * Personal access tokens for the read-only HTTP API.
 *
 * A token is `wbz_` followed by 32 random bytes in base64url. Only its SHA-256
 * is stored, so a database leak yields nothing usable, and the same hash is
 * the Redis cache key on the request path. The plan's `api_access` feature is
 * checked when a token is used, not only when it is created, so a downgrade
 * switches keys off without touching them.
 */

export const API_KEY_PREFIX = "wbz_";
const RANDOM_BYTES = 32;
/** base64url of 32 bytes is 43 characters, no padding. */
const TOKEN_PATTERN = /^wbz_[A-Za-z0-9_-]{43}$/;
/** How much of the token the owner sees in the list: the prefix plus 8 chars. */
const VISIBLE_CHARS = API_KEY_PREFIX.length + 8;

const CACHE_PREFIX = "apikey:";
const CACHE_TTL = 60; // seconds
const TOUCH_PREFIX = "apikey:touch:";
const TOUCH_EVERY = 60; // seconds between last_used_at writes per key

export const hashApiKey = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");

/** Shape check only: anything that is not a token never reaches the database. */
export const looksLikeApiKey = (value: string): boolean => TOKEN_PATTERN.test(value);

export const generateApiKey = (): { token: string; prefix: string; hash: string } => {
  const token = API_KEY_PREFIX + crypto.randomBytes(RANDOM_BYTES).toString("base64url");
  return { token, prefix: token.slice(0, VISIBLE_CHARS), hash: hashApiKey(token) };
};

/** Pull the token out of an Authorization header, or null when it is not a bearer token of ours. */
export const bearerApiKey = (authorization: string | undefined): string | null => {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (!match) return null;
  return looksLikeApiKey(match[1]) ? match[1] : null;
};

export type ApiKeyRecord = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

const RECORD_SELECT = {
  id: true,
  name: true,
  keyPrefix: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

export const MAX_KEYS_PER_USER = 20;

/**
 * Create a key. The plan must include api_access; that is checked here as well
 * as on use so the settings page cannot mint keys that will never work. The
 * plaintext token is returned once and never stored.
 */
export const createApiKey = async (
  ctx: AppContext,
  userId: string,
  name: string,
): Promise<{ key: ApiKeyRecord; token: string }> => {
  await assertFeature(ctx, userId, "api_access");

  const live = await ctx.prisma.apiKey.count({ where: { userId, revokedAt: null } });
  if (live >= MAX_KEYS_PER_USER) throw tooManyApiKeys(MAX_KEYS_PER_USER);

  const generated = generateApiKey();
  const key = await ctx.prisma.apiKey.create({
    data: { userId, name: name.trim(), keyPrefix: generated.prefix, keyHash: generated.hash },
    select: RECORD_SELECT,
  });

  return { key, token: generated.token };
};

/** Every key the user has made, revoked ones included so the list explains history. */
export const listApiKeys = async ({ prisma }: AppContext, userId: string): Promise<ApiKeyRecord[]> =>
  prisma.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: RECORD_SELECT,
  });

/** Revoke a key the user owns. Idempotent; the cache entry dies with it. */
export const revokeApiKey = async (ctx: AppContext, userId: string, keyId: string): Promise<ApiKeyRecord> => {
  const existing = await ctx.prisma.apiKey.findFirst({
    where: { id: keyId, userId },
    select: { id: true, keyHash: true, revokedAt: true },
  });
  if (!existing) throw notFound("API key not found");

  const key = existing.revokedAt
    ? await ctx.prisma.apiKey.findUniqueOrThrow({ where: { id: keyId }, select: RECORD_SELECT })
    : await ctx.prisma.apiKey.update({
        where: { id: keyId },
        data: { revokedAt: new Date() },
        select: RECORD_SELECT,
      });

  await ctx.redis.del(`${CACHE_PREFIX}${existing.keyHash}`).catch(() => {});
  return key;
};

export type ApiKeyPrincipal = {
  apiKeyId: string;
  userId: string;
  email: string;
  name: string;
};

/**
 * Resolve a bearer token to its owner, or null when the token is unknown or
 * revoked. Cached for a minute per token hash. The plan check runs on every
 * call, cached or not, through the entitlement cache; a plan without
 * api_access throws FEATURE_NOT_AVAILABLE so the caller sees why.
 */
export const validateApiKey = async (ctx: AppContext, token: string): Promise<ApiKeyPrincipal | null> => {
  if (!looksLikeApiKey(token)) return null;
  const hash = hashApiKey(token);
  const cacheKey = `${CACHE_PREFIX}${hash}`;

  let principal: ApiKeyPrincipal | null = null;

  const cached = await ctx.redis.get(cacheKey).catch(() => null);
  if (cached) {
    try {
      principal = JSON.parse(cached) as ApiKeyPrincipal;
    } catch {
      principal = null;
    }
  }

  if (!principal) {
    const row = await ctx.prisma.apiKey.findUnique({
      where: { keyHash: hash },
      select: {
        id: true,
        revokedAt: true,
        user: { select: { id: true, email: true, name: true, isActive: true } },
      },
    });
    if (!row || row.revokedAt || !row.user.isActive) return null;

    principal = { apiKeyId: row.id, userId: row.user.id, email: row.user.email, name: row.user.name };
    await ctx.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(principal)).catch(() => {});
  }

  await assertFeature(ctx, principal.userId, "api_access");

  void touchLastUsed(ctx, principal.apiKeyId);
  return principal;
};

/** Record use at most once a minute per key; the write is best effort. */
const touchLastUsed = async (ctx: AppContext, apiKeyId: string) => {
  try {
    const first = await ctx.redis.set(`${TOUCH_PREFIX}${apiKeyId}`, "1", "EX", TOUCH_EVERY, "NX");
    if (first !== "OK") return;
    await ctx.prisma.apiKey.update({ where: { id: apiKeyId }, data: { lastUsedAt: new Date() } });
  } catch {
    // Telemetry only; never fail a request over it.
  }
};
