import { randomBytes } from "node:crypto";

import { AppContext } from "../../lib/context.js";
import { GSC_ENABLED } from "../../config/env.js";
import { decryptSecret, encryptSecret } from "./token-crypto.js";
import {
  GscAuthError,
  GscDimension,
  GscRow,
  buildGscAuthUrl,
  exchangeGscCode,
  getGscAccountEmail,
  listGscProperties,
  queryGscSearchAnalytics,
  refreshGscAccessToken,
  revokeGscToken,
} from "./gsc-client.js";
import {
  gscNoProperty,
  gscNotConfigured,
  gscNotConnected,
  gscReauthRequired,
} from "../../errors/domain-errors.js";
import { badRequest } from "../../errors/http-errors.js";
import { assertFeature } from "../billing/entitlements/entitlement.guard.js";

/**
 * Google Search Console integration, Plausible-style: search data is pulled
 * live from Google per request and cached briefly in Redis. Nothing is synced
 * into ClickHouse - Google is the source of truth, keeps ~16 months, and its
 * numbers lag reality by roughly two days.
 */

const STATE_TTL_SECONDS = 60 * 10;
const DATA_CACHE_TTL_SECONDS = 60 * 10;
/** One fetch serves search/sort/pagination server-side from this window. */
const ROW_FETCH_LIMIT = 1000;
/** GSC retains 16 months; asking for more is an API error. */
const MAX_LOOKBACK_DAYS = 480;

const stateKey = (state: string) => `gsc:state:${state}`;
const tokenKey = (websiteId: string) => `gsc:token:${websiteId}`;
const dataKey = (
  websiteId: string,
  property: string,
  start: string,
  end: string,
  dimensions: string,
) => `gsc:data:${websiteId}:${property}:${start}:${end}:${dimensions}`;

const requireConfigured = () => {
  if (!GSC_ENABLED) throw gscNotConfigured();
};

// ─── Connect flow ─────────────────────────────────────────────────────────────

type StatePayload = { siteId: string; userId: string; domain: string };

export const createGscAuthUrl = async (
  { redis }: AppContext,
  payload: StatePayload,
): Promise<string> => {
  requireConfigured();
  const state = randomBytes(24).toString("hex");
  await redis.setex(stateKey(state), STATE_TTL_SECONDS, JSON.stringify(payload));
  return buildGscAuthUrl(state);
};

/** Validates and consumes the state, exchanges the code, stores the grant. */
export const completeGscConnection = async (
  ctx: AppContext,
  state: string,
  code: string,
): Promise<StatePayload> => {
  requireConfigured();
  const { redis, prisma } = ctx;

  const raw = await redis.get(stateKey(state));
  // DEL doubles as atomic consume so a replayed callback cannot reuse it.
  const consumed = raw ? await redis.del(stateKey(state)) : 0;
  if (!raw || consumed !== 1) throw badRequest("Invalid or expired state");

  const payload = JSON.parse(raw) as StatePayload;

  // The auth URL route is plan-gated, but the plan can change between consent
  // and callback; never store a grant for an account whose plan lacks it.
  await assertFeature(ctx, payload.userId, "search_console");

  const tokens = await exchangeGscCode(code);
  if (!tokens.refresh_token) {
    throw badRequest("Google did not return a refresh token");
  }

  const email = await getGscAccountEmail(tokens.access_token);

  // Reconnecting keeps the selected property; it is re-validated on use.
  await prisma.searchConsoleConnection.upsert({
    where: { websiteId: payload.siteId },
    create: {
      websiteId: payload.siteId,
      refreshToken: encryptSecret(tokens.refresh_token),
      googleEmail: email,
    },
    update: { refreshToken: encryptSecret(tokens.refresh_token), googleEmail: email },
  });

  // Prime the access-token cache with the one we already have.
  await cacheAccessToken(ctx, payload.siteId, tokens.access_token, tokens.expires_in);

  return payload;
};

// ─── Tokens ───────────────────────────────────────────────────────────────────

const cacheAccessToken = async (
  { redis }: AppContext,
  websiteId: string,
  accessToken: string,
  expiresIn: number,
) => {
  // Expire well before Google does so a cached token is never near-dead.
  const ttl = Math.max(expiresIn - 300, 60);
  await redis.setex(tokenKey(websiteId), ttl, accessToken).catch(() => {});
};

const getConnection = async ({ prisma }: AppContext, websiteId: string) => {
  const connection = await prisma.searchConsoleConnection.findUnique({
    where: { websiteId },
  });
  if (!connection) throw gscNotConnected();
  return connection;
};

/**
 * A usable access token for this site's connection, from cache or by
 * refreshing. A dead refresh token surfaces as GSC_REAUTH_REQUIRED so the UI
 * can offer a reconnect instead of a generic failure.
 */
const getAccessToken = async (
  ctx: AppContext,
  websiteId: string,
): Promise<string> => {
  // Cache only: a Redis failure means a fresh token exchange.
  const cached = await ctx.redis.get(tokenKey(websiteId)).catch(() => null);
  if (cached) return cached;

  const connection = await getConnection(ctx, websiteId);
  try {
    const tokens = await refreshGscAccessToken(decryptSecret(connection.refreshToken));
    await cacheAccessToken(ctx, websiteId, tokens.access_token, tokens.expires_in);
    return tokens.access_token;
  } catch (error) {
    if (error instanceof GscAuthError) throw gscReauthRequired();
    throw error;
  }
};

// ─── Status / properties / disconnect ─────────────────────────────────────────

export const getGscStatus = async (ctx: AppContext, websiteId: string) => {
  if (!GSC_ENABLED) {
    return { configured: false, connected: false, property: null, google_email: null };
  }

  const connection = await ctx.prisma.searchConsoleConnection.findUnique({
    where: { websiteId },
  });

  return {
    configured: true,
    connected: Boolean(connection),
    property: connection?.propertyUri ?? null,
    google_email: connection?.googleEmail ?? null,
  };
};

export const listProperties = async (ctx: AppContext, websiteId: string) => {
  requireConfigured();
  const accessToken = await getAccessToken(ctx, websiteId);
  try {
    return await listGscProperties(accessToken);
  } catch (error) {
    if (error instanceof GscAuthError) throw gscReauthRequired();
    throw error;
  }
};

export const selectProperty = async (
  ctx: AppContext,
  websiteId: string,
  propertyUri: string,
) => {
  requireConfigured();
  await getConnection(ctx, websiteId);

  // Only a property the connected account can actually read is accepted.
  const properties = await listProperties(ctx, websiteId);
  if (!properties.some((p) => p.siteUrl === propertyUri)) {
    throw badRequest("Property is not accessible by the connected account");
  }

  await ctx.prisma.searchConsoleConnection.update({
    where: { websiteId },
    data: { propertyUri },
  });
};

export const disconnectGsc = async (ctx: AppContext, websiteId: string) => {
  const connection = await getConnection(ctx, websiteId);

  // Best effort at Google; the local grant is removed regardless.
  await revokeGscToken(decryptSecret(connection.refreshToken));
  await ctx.prisma.searchConsoleConnection.delete({ where: { websiteId } });
  await ctx.redis.del(tokenKey(websiteId));
};

// ─── Search analytics ─────────────────────────────────────────────────────────

export type GscSortKey = "clicks" | "impressions" | "ctr" | "position";

export type SearchAnalyticsInput = {
  websiteId: string;
  timezone: string;
  from: number; // epoch seconds, inclusive
  to: number; // epoch seconds, exclusive
  dimension: GscDimension;
  search?: string;
  sort: GscSortKey;
  order: "asc" | "desc";
  limit: number;
  page: number;
};

export type GscTotals = {
  clicks: number;
  impressions: number;
  ctr: number; // percent
  position: number;
};

export type GscTermRow = GscTotals & { key: string };

const EMPTY_TOTALS: GscTotals = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

/** Epoch seconds -> that instant's calendar date in the site's timezone. */
const dateInZone = (epochSeconds: number, timezone: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochSeconds * 1000));

/**
 * The resolved period window as inclusive GSC dates, clamped to Google's
 * 16-month retention. `to` is exclusive (start of the next day), so the end
 * date is the day containing `to - 1s`.
 */
const toGscDates = (from: number, to: number, timezone: string) => {
  const oldestAllowed = Math.floor(Date.now() / 1000) - MAX_LOOKBACK_DAYS * 86400;
  const clampedFrom = Math.max(from, oldestAllowed);
  return {
    startDate: dateInZone(Math.min(clampedFrom, to - 1), timezone),
    endDate: dateInZone(to - 1, timezone),
  };
};

/** Cached raw GSC rows for one (property, window, dimensions) combination. */
const fetchRowsCached = async (
  ctx: AppContext,
  input: {
    websiteId: string;
    property: string;
    startDate: string;
    endDate: string;
    dimensions: GscDimension[];
  },
): Promise<GscRow[]> => {
  const key = dataKey(
    input.websiteId,
    input.property,
    input.startDate,
    input.endDate,
    input.dimensions.join(",") || "totals",
  );

  // Cache only: a Redis failure means one more call to Google.
  const cached = await ctx.redis.get(key).catch(() => null);
  if (cached) return JSON.parse(cached) as GscRow[];

  const accessToken = await getAccessToken(ctx, input.websiteId);
  let rows: GscRow[];
  try {
    rows = await queryGscSearchAnalytics(accessToken, input.property, {
      startDate: input.startDate,
      endDate: input.endDate,
      dimensions: input.dimensions.length ? input.dimensions : undefined,
      rowLimit: input.dimensions.length ? ROW_FETCH_LIMIT : 1,
      type: "web",
    });
  } catch (error) {
    if (error instanceof GscAuthError) throw gscReauthRequired();
    throw error;
  }

  await ctx.redis.setex(key, DATA_CACHE_TTL_SECONDS, JSON.stringify(rows)).catch(() => {});
  return rows;
};

const toTotals = (row?: GscRow): GscTotals =>
  row
    ? {
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: Math.round(row.ctr * 10000) / 100,
        position: Math.round(row.position * 10) / 10,
      }
    : EMPTY_TOTALS;

export const getSearchAnalytics = async (
  ctx: AppContext,
  input: SearchAnalyticsInput,
) => {
  requireConfigured();
  const connection = await getConnection(ctx, input.websiteId);
  if (!connection.propertyUri) throw gscNoProperty();
  const property = connection.propertyUri;

  const { startDate, endDate } = toGscDates(input.from, input.to, input.timezone);

  // Previous window of the same span, same comparison rule as top-stats.
  const span = input.to - input.from;
  const prev = toGscDates(input.from - span, input.from, input.timezone);

  const base = { websiteId: input.websiteId, property };
  const [rows, totalsRow, prevTotalsRow] = await Promise.all([
    fetchRowsCached(ctx, {
      ...base,
      startDate,
      endDate,
      dimensions: [input.dimension],
    }),
    fetchRowsCached(ctx, { ...base, startDate, endDate, dimensions: [] }),
    fetchRowsCached(ctx, {
      ...base,
      startDate: prev.startDate,
      endDate: prev.endDate,
      dimensions: [],
    }),
  ]);

  const search = input.search?.trim().toLowerCase();
  const filtered: GscTermRow[] = rows
    .map((row) => ({ key: row.keys?.[0] ?? "", ...toTotals(row) }))
    .filter((row) => !search || row.key.toLowerCase().includes(search));

  const direction = input.order === "asc" ? 1 : -1;
  filtered.sort((a, b) => {
    const diff = (a[input.sort] - b[input.sort]) * direction;
    // Clicks as secondary rank, then key, so ordering is deterministic.
    return diff !== 0 ? diff : b.clicks - a.clicks || a.key.localeCompare(b.key);
  });

  const offset = (input.page - 1) * input.limit;
  const pageRows = filtered.slice(offset, offset + input.limit);

  return {
    property,
    start_date: startDate,
    end_date: endDate,
    // GSC returns at most ROW_FETCH_LIMIT rows per window; flag the cut so
    // the UI can say "top 1,000" instead of implying completeness.
    truncated: rows.length >= ROW_FETCH_LIMIT,
    summary: toTotals(totalsRow[0]),
    previous: toTotals(prevTotalsRow[0]),
    results: pageRows,
    meta: {
      page: input.page,
      limit: input.limit,
      total_items: filtered.length,
      has_more: offset + pageRows.length < filtered.length,
    },
  };
};
