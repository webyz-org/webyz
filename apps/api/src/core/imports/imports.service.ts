import { randomBytes } from "node:crypto";

import { GA4_IMPORT_ENABLED } from "../../config/env.js";
import { AppContext } from "../../lib/context.js";
import { Prisma } from "../../generated/prisma/client.js";
import { badRequest } from "../../errors/http-errors.js";
import {
  importLimitReached,
  importNotConfigured,
  importNotConnected,
  importNotFound,
  importNothingToImport,
  importOverlaps,
  importPropertyNotFound,
  importReauthRequired,
} from "../../errors/domain-errors.js";
import { decryptSecret, encryptSecret } from "../gsc/token-crypto.js";
import {
  deleteImportedRows,
  firstTrackedDate,
  insertImportedRows,
} from "../../db/clickhouse/imported.js";
import {
  Ga4AuthError,
  Ga4QuotaError,
  buildGa4AuthUrl,
  exchangeGa4Code,
  getGa4Metadata,
  getGa4Property,
  getGoogleAccountEmail,
  listGa4Properties,
  refreshGa4AccessToken,
  revokeGa4Token,
  runGa4Report,
} from "./ga4-client.js";
import { runGa4Import, type Ga4Source } from "./ga4-import.js";
import { GA4_NOT_IMPORTED, GA4_REPORTS } from "./ga4-reports.js";
import { PLAUSIBLE_NOT_IMPORTED } from "./plausible-csv.js";
import { addDays, isIsoDate, localToday } from "./dates.js";
import { invalidateImportedWindow } from "./imported-window.js";

/**
 * Google Analytics 4 import, Plausible-style: the owner connects a Google
 * account, picks a property and a range, and a background job copies the
 * property's daily aggregates into `imported_stats`. The dashboard then adds
 * them to its numbers for days before tracking began.
 *
 * The Google grant lives in Redis for an hour between consent and start
 * (encrypted, like every stored refresh token), then on the import row while
 * the job runs, and is revoked and deleted the moment the job ends. Webyz
 * keeps no standing access to anyone's Google Analytics.
 *
 * Up to MAX_IMPORTS imports per site, GA4 and CSV mixed, as in Plausible, as
 * long as their dates do not overlap: every imported day comes from exactly
 * one import, so merging stays addition (`assertImportSlot`).
 */

/** Imports a site may hold at once (Plausible's limit too). */
export const MAX_IMPORTS = 5;

/**
 * Refuse a new import when the site is at the limit or its dates overlap an
 * import that is queued, running or done. Failed imports hold no data.
 */
export const assertImportSlot = async (
  ctx: AppContext,
  siteId: string,
  range: { start: string; end: string },
) => {
  const live = await ctx.prisma.siteImport.findMany({
    where: { websiteId: siteId, status: { in: ["PENDING", "RUNNING", "COMPLETED"] } },
    select: { startDate: true, endDate: true },
  });
  if (live.length >= MAX_IMPORTS) throw importLimitReached(MAX_IMPORTS);
  for (const other of live) {
    const start = other.startDate.toISOString().slice(0, 10);
    const end = other.endDate.toISOString().slice(0, 10);
    if (range.start <= end && range.end >= start) throw importOverlaps({ start, end });
  }
};

const STATE_TTL_SECONDS = 10 * 60;
const DRAFT_TTL_SECONDS = 60 * 60;
/** A RUNNING import whose heartbeat is older than this was abandoned. */
const STALE_AFTER_MS = 10 * 60_000;
const QUOTA_RETRIES = 6;
const QUOTA_WAIT_MS = 60_000;

const stateKey = (state: string) => `ga4:state:${state}`;
const draftKey = (siteId: string) => `ga4:draft:${siteId}`;

const requireConfigured = () => {
  if (!GA4_IMPORT_ENABLED) throw importNotConfigured();
};

type StatePayload = { siteId: string; userId: string; domain: string };
type Draft = { refreshToken: string; email: string | null };

// ─── Connect ──────────────────────────────────────────────────────────────────

export const createImportAuthUrl = async (
  { redis }: AppContext,
  payload: StatePayload,
): Promise<string> => {
  requireConfigured();
  const state = randomBytes(24).toString("hex");
  await redis.setex(stateKey(state), STATE_TTL_SECONDS, JSON.stringify(payload));
  return buildGa4AuthUrl(state);
};

/** Consumes the state, exchanges the code, parks the grant for an hour. */
export const completeImportConnection = async (
  { redis }: AppContext,
  state: string,
  code: string,
): Promise<StatePayload> => {
  requireConfigured();
  const raw = await redis.get(stateKey(state));
  const consumed = raw ? await redis.del(stateKey(state)) : 0;
  if (!raw || consumed !== 1) throw badRequest("Invalid or expired state");
  const payload = JSON.parse(raw) as StatePayload;

  const tokens = await exchangeGa4Code(code);
  if (!tokens.refresh_token) throw badRequest("Google did not return a refresh token");
  const email = await getGoogleAccountEmail(tokens.access_token);

  const draft: Draft = { refreshToken: encryptSecret(tokens.refresh_token), email };
  await redis.setex(draftKey(payload.siteId), DRAFT_TTL_SECONDS, JSON.stringify(draft));
  return payload;
};

const readDraft = async ({ redis }: AppContext, siteId: string): Promise<Draft | null> => {
  const raw = await redis.get(draftKey(siteId)).catch(() => null);
  return raw ? (JSON.parse(raw) as Draft) : null;
};

const accessTokenFor = async (encryptedRefreshToken: string): Promise<string> => {
  try {
    return (await refreshGa4AccessToken(decryptSecret(encryptedRefreshToken))).access_token;
  } catch (error) {
    if (error instanceof Ga4AuthError) throw importReauthRequired();
    throw error;
  }
};

/** The connected account and its properties, for the picker. */
export const getImportConnection = async (ctx: AppContext, siteId: string) => {
  if (!GA4_IMPORT_ENABLED) return { configured: false, connected: false, email: null, properties: [] };
  const draft = await readDraft(ctx, siteId);
  if (!draft) return { configured: true, connected: false, email: null, properties: [] };
  const accessToken = await accessTokenFor(draft.refreshToken);
  try {
    const properties = await listGa4Properties(accessToken);
    return { configured: true, connected: true, email: draft.email, properties };
  } catch (error) {
    if (error instanceof Ga4AuthError) throw importReauthRequired();
    throw error;
  }
};

/** Forget a connection the owner did not use. */
export const discardImportConnection = async (ctx: AppContext, siteId: string) => {
  const draft = await readDraft(ctx, siteId);
  await ctx.redis.del(draftKey(siteId)).catch(() => null);
  if (draft) await revokeGa4Token(decryptSecret(draft.refreshToken));
};

// ─── Start / list / delete ────────────────────────────────────────────────────

const toIso = (date: Date) => date.toISOString().slice(0, 10);

export const serializeImport = (row: {
  id: string;
  source: string;
  propertyId: string;
  propertyName: string | null;
  startDate: Date;
  endDate: Date;
  status: string;
  stepsDone: number;
  stepsTotal: number;
  rowsImported: number;
  skipped: string[];
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}) => ({
  id: row.id,
  source: row.source,
  property_id: row.propertyId,
  property_name: row.propertyName,
  start_date: toIso(row.startDate),
  end_date: toIso(row.endDate),
  status: row.status.toLowerCase(),
  steps_done: row.stepsDone,
  steps_total: row.stepsTotal,
  rows_imported: row.rowsImported,
  skipped: row.skipped,
  not_imported: row.source === "csv" ? PLAUSIBLE_NOT_IMPORTED : GA4_NOT_IMPORTED,
  error: row.error,
  created_at: row.createdAt.toISOString(),
  completed_at: row.completedAt?.toISOString() ?? null,
});

export const listImports = async ({ prisma }: AppContext, siteId: string) => {
  const rows = await prisma.siteImport.findMany({
    where: { websiteId: siteId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(serializeImport);
};

export type StartImportInput = {
  siteId: string;
  timezone: string;
  userId: string;
  propertyId: string;
  startDate?: string;
  endDate?: string;
};

/**
 * Resolve the range and queue the job. The end is clipped to yesterday and to
 * the day before the site's first tracked session, the start to the day the
 * property was created; a range that clips to nothing is refused with the
 * reason rather than queued to import zero rows.
 */
export const startImport = async (ctx: AppContext, input: StartImportInput) => {
  requireConfigured();
  const draft = await readDraft(ctx, input.siteId);
  if (!draft) throw importNotConnected();

  for (const date of [input.startDate, input.endDate]) {
    if (date !== undefined && !isIsoDate(date)) throw badRequest("Dates must be YYYY-MM-DD");
  }

  const accessToken = await accessTokenFor(draft.refreshToken);
  let propertyName: string;
  let createdDay: string | null;
  try {
    const properties = await listGa4Properties(accessToken);
    const property = properties.find((p) => p.id === input.propertyId);
    if (!property) throw importPropertyNotFound();
    propertyName = property.name;
    const details = await getGa4Property(accessToken, input.propertyId);
    createdDay = details.createTime ? details.createTime.slice(0, 10) : null;
  } catch (error) {
    if (error instanceof Ga4AuthError) throw importReauthRequired();
    throw error;
  }

  const yesterday = addDays(localToday(input.timezone), -1);
  const firstTracked = await firstTrackedDate(ctx.clickhouse, input.siteId, input.timezone);
  const ends = [input.endDate ?? yesterday, yesterday];
  if (firstTracked) ends.push(addDays(firstTracked, -1));
  const endDate = ends.sort()[0];
  const starts = [input.startDate ?? createdDay ?? "2015-08-14"];
  if (createdDay) starts.push(createdDay);
  const startDate = starts.sort().reverse()[0];

  if (startDate > endDate) {
    if (firstTracked) throw importNothingToImport(firstTracked);
    throw badRequest("The start date is after the end date");
  }
  await assertImportSlot(ctx, input.siteId, { start: startDate, end: endDate });

  const row = await ctx.prisma.siteImport.create({
    data: {
      websiteId: input.siteId,
      createdById: input.userId,
      propertyId: input.propertyId,
      propertyName,
      startDate: new Date(`${startDate}T00:00:00Z`),
      endDate: new Date(`${endDate}T00:00:00Z`),
      refreshToken: draft.refreshToken,
      stepsTotal: GA4_REPORTS.length,
    },
  });
  await ctx.redis.del(draftKey(input.siteId)).catch(() => null);

  // Start now rather than waiting up to a minute for the job; the job is the
  // safety net if this process stops halfway.
  void processImport(ctx, row.id).catch(() => {});
  return serializeImport(row);
};

/** Deletes the import and its rows. A running job notices and stops. */
export const deleteImport = async (ctx: AppContext, siteId: string, importId: string) => {
  const row = await ctx.prisma.siteImport.findFirst({ where: { id: importId, websiteId: siteId } });
  if (!row) throw importNotFound();
  await ctx.prisma.siteImport.delete({ where: { id: row.id } });
  await invalidateImportedWindow(ctx, siteId);
  if (row.refreshToken) await revokeGa4Token(decryptSecret(row.refreshToken));
  await deleteImportedRows(ctx.clickhouse, row.id);
};

// ─── Job ──────────────────────────────────────────────────────────────────────

const realSource = (refreshToken: string, propertyId: string): Ga4Source => {
  let token: { value: string; expiresAt: number } | null = null;
  const accessToken = async () => {
    if (token && token.expiresAt > Date.now()) return token.value;
    const fresh = await refreshGa4AccessToken(refreshToken);
    token = { value: fresh.access_token, expiresAt: Date.now() + (fresh.expires_in - 300) * 1000 };
    return token.value;
  };
  const withQuotaRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (!(error instanceof Ga4QuotaError) || attempt >= QUOTA_RETRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, QUOTA_WAIT_MS));
      }
    }
  };
  return {
    metadata: async () => withQuotaRetry(async () => getGa4Metadata(await accessToken(), propertyId)),
    runReport: async (request) => withQuotaRetry(async () => runGa4Report(await accessToken(), propertyId, request)),
  };
};

/** Readable reason for the owner; the full error goes to the log. */
const failureMessage = (error: unknown) => {
  if (error instanceof Ga4AuthError) return "Google stopped accepting the connection. Delete this import and start again.";
  if (error instanceof Ga4QuotaError) return "Google's Analytics quota for this property ran out. Try again tomorrow.";
  return "The import failed. Delete it and try again; if it keeps failing, contact support.";
};

/**
 * Claim and run one import. Claiming is a conditional update, so two API
 * instances (or the job and the start request) never run the same import.
 * Every run starts by deleting the import's rows, which makes a resumed run
 * after a crash write each row exactly once.
 */
export const processImport = async (
  ctx: AppContext,
  importId: string,
  sourceFor: (refreshToken: string, propertyId: string) => Ga4Source = realSource,
): Promise<"done" | "failed" | "skipped"> => {
  const now = new Date();
  const claimed = await ctx.prisma.siteImport.updateMany({
    where: {
      id: importId,
      source: "ga4",
      OR: [
        { status: "PENDING" },
        { status: "RUNNING", heartbeatAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) } },
      ],
    },
    data: { status: "RUNNING", heartbeatAt: now, startedAt: now, stepsDone: 0, rowsImported: 0, error: null },
  });
  if (claimed.count !== 1) return "skipped";

  const row = await ctx.prisma.siteImport.findUnique({ where: { id: importId } });
  if (!row?.refreshToken) return "skipped";
  const refreshToken = decryptSecret(row.refreshToken);

  // Prisma throws P2025 when the row was deleted mid-run; that is a stop, not a failure.
  const update = async (data: Prisma.SiteImportUpdateInput) =>
    ctx.prisma.siteImport.update({ where: { id: importId }, data }).catch((error) => {
      if (error?.code === "P2025") return null;
      throw error;
    });

  // Between pages: keep the heartbeat fresh (one large report can take longer
  // than the stale window) and stop if the owner deleted the import.
  const stillThere = async () => Boolean(await update({ heartbeatAt: new Date() }));

  try {
    await deleteImportedRows(ctx.clickhouse, importId);
    const outcome = await runGa4Import({
      source: sourceFor(refreshToken, row.propertyId),
      startDate: toIso(row.startDate),
      endDate: toIso(row.endDate),
      write: (rows) =>
        insertImportedRows(
          ctx.clickhouse,
          rows.map((r) => ({ ...r, website_id: row.websiteId, import_id: importId })),
        ),
      onProgress: async ({ stepsDone, stepsTotal, rows }) => {
        await update({ stepsDone, stepsTotal, rowsImported: rows, heartbeatAt: new Date() });
      },
      shouldContinue: stillThere,
    });

    if (!(await stillThere())) {
      await deleteImportedRows(ctx.clickhouse, importId);
      return "skipped";
    }
    await update({
      status: "COMPLETED",
      completedAt: new Date(),
      refreshToken: null,
      rowsImported: outcome.rows,
      skipped: outcome.skipped,
    });
    await invalidateImportedWindow(ctx, row.websiteId);
    return "done";
  } catch (error) {
    console.error(`[imports] ${importId} failed`, error);
    await update({ status: "FAILED", completedAt: new Date(), refreshToken: null, error: failureMessage(error) });
    await deleteImportedRows(ctx.clickhouse, importId).catch(() => {});
    return "failed";
  } finally {
    await revokeGa4Token(refreshToken);
  }
};

/** Cron: run queued imports and resume ones a restart abandoned. */
export const processPendingImports = async (
  ctx: AppContext,
  sourceFor?: (refreshToken: string, propertyId: string) => Ga4Source,
) => {
  const stale = new Date(Date.now() - STALE_AFTER_MS);
  // GA4 only: a Plausible import is an upload with no job to resume.
  const due = await ctx.prisma.siteImport.findMany({
    where: {
      source: "ga4",
      OR: [{ status: "PENDING" }, { status: "RUNNING", heartbeatAt: { lt: stale } }],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  const results = [];
  for (const { id } of due) results.push(await processImport(ctx, id, sourceFor));
  return results;
};
