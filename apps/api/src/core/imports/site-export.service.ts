import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { AppContext } from "../../lib/context.js";
import { APP_URL, EXPORTS_DIR } from "../../config/env.js";
import { exportEmpty, exportNotFound } from "../../errors/domain-errors.js";
import { sendEmail } from "../email/email.service.js";
import { exportReadyEmail } from "../email/templates/index.js";
import {
  EXPORT_QUERIES,
  exportDateSpan,
  exportLocationRows,
  exportReportStream,
  type ExportParams,
} from "../../db/clickhouse/site-export.js";
import { createZipWriter } from "../../utils/zip-stream.js";
import { getGeoNames } from "./geo-names.js";
import { localToday } from "./dates.js";

/**
 * "Export data", Plausible's flow: the site's tracked history as one zip of
 * CSVs in Plausible's import format, so it imports back into Webyz (Import
 * from CSV) or into Plausible as it is. "Export to CSV" builds it in the
 * background into EXPORTS_DIR, the requester is emailed when it is ready, it
 * downloads from site settings for EXPORT_TTL_DAYS and is then deleted with
 * its file. One export per site; a new one replaces the old. Imported history
 * is not re-exported, as in Plausible; the window is cut to the plan's
 * retention like every read.
 */

/** "nihaln.com" on 5 Oct 2026 -> "nihaln_com_20261005.zip", Plausible's naming. */
export const exportArchiveName = (domain: string, day: string) =>
  `${domain.replace(/\./g, "_")}_${day.replace(/-/g, "")}.zip`;

/** A value in CSV as ClickHouse writes it: strings quoted, quotes doubled. */
const csvString = (value: string) => `"${value.replace(/"/g, '""')}"`;

const LOCATION_HEADER = '"date","country","region","city","visitors","visits","visit_duration","bounces","pageviews"\n';

async function* locationCsv(ctx: AppContext, params: ExportParams): AsyncGenerator<string> {
  const [rows, geo] = await Promise.all([exportLocationRows(ctx.clickhouse, params), getGeoNames()]);
  yield LOCATION_HEADER;
  let batch = "";
  for (const r of rows) {
    // Tracked rows keep names; the format wants an ISO 3166-2 region and a
    // GeoNames city id. A region the geo database does not name (an older
    // edition's spelling) goes out as its name, which Webyz's importer reads
    // back, rather than being lost; a city without an id has nowhere to go
    // in a numeric column and is 0, unknown.
    const region = r.region ? (geo?.regionCodes.get(`${r.country}\u0000${r.region}`) ?? r.region) : "";
    const city = r.city ? (geo?.cityIds.get(`${r.country}\u0000${r.city}`) ?? 0) : 0;
    batch += `${csvString(r.date)},${csvString(r.country)},${csvString(region)},${city},${r.visitors},${r.visits},${r.visit_duration},${r.bounces},${r.pageviews}\n`;
    if (batch.length > 64_000) {
      yield batch;
      batch = "";
    }
  }
  if (batch) yield batch;
}

export const streamSiteExport = async (
  ctx: AppContext,
  input: { websiteId: string; domain: string; timezone: string; from: number; to: number },
): Promise<{ filename: string; stream: Readable }> => {
  const params: ExportParams = { websiteId: input.websiteId, from: input.from, to: input.to, timezone: input.timezone };
  const span = await exportDateSpan(ctx.clickhouse, params);
  if (!span) throw exportEmpty();

  const range = `${span.first.replace(/-/g, "")}_${span.last.replace(/-/g, "")}`;
  const zip = createZipWriter();

  // Written in the background so the response starts at once; a failure part
  // way through ends the download broken rather than silently short.
  void (async () => {
    try {
      for (const { report, sql } of EXPORT_QUERIES) {
        await zip.add(`${report}_${range}.csv`, await exportReportStream(ctx.clickhouse, sql, params));
        if (report === "imported_custom_events") {
          await zip.add(`imported_locations_${range}.csv`, locationCsv(ctx, params));
        }
      }
      await zip.finish();
    } catch (error) {
      console.error(`[export] ${input.websiteId} failed`, error);
      zip.fail(error as Error);
    }
  })();

  return { filename: exportArchiveName(input.domain, localToday(input.timezone)), stream: zip.stream };
};

// ─── Prepared exports ─────────────────────────────────────────────────────────

/** How long a prepared export can be downloaded, as in Plausible. */
export const EXPORT_TTL_DAYS = 7;
/** A RUNNING export older than this was cut off by a restart. */
const STALE_AFTER_MS = 60 * 60_000;

const filePath = (id: string) => path.join(EXPORTS_DIR, `${id}.zip`);
const partPath = (id: string) => path.join(EXPORTS_DIR, `${id}.zip.part`);

type ExportRow = {
  id: string;
  filename: string;
  status: string;
  sizeBytes: bigint | null;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
};

const serializeExport = (row: ExportRow) => ({
  id: row.id,
  filename: row.filename,
  status: row.status.toLowerCase(),
  size_bytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
  error: row.error,
  created_at: row.createdAt.toISOString(),
  completed_at: row.completedAt?.toISOString() ?? null,
  expires_at: row.expiresAt?.toISOString() ?? null,
});

const removeFiles = async (id: string) => {
  await rm(filePath(id), { force: true });
  await rm(partPath(id), { force: true });
};

/** The site's current export, or null. */
export const getSiteExport = async (ctx: AppContext, siteId: string) => {
  const row = await ctx.prisma.siteExport.findFirst({ where: { websiteId: siteId }, orderBy: { createdAt: "desc" } });
  return row ? serializeExport(row) : null;
};

/**
 * Start an export: replace any earlier one, check there is data, then build
 * the zip in the background (`.part` first, renamed when complete, so a
 * download never reads half a file) and email the requester.
 */
export const requestSiteExport = async (
  ctx: AppContext,
  input: { websiteId: string; domain: string; timezone: string; from: number; to: number; userId: string },
) => {
  const previous = await ctx.prisma.siteExport.findMany({ where: { websiteId: input.websiteId }, select: { id: true } });
  for (const { id } of previous) {
    await removeFiles(id);
    await ctx.prisma.siteExport.delete({ where: { id } }).catch(() => null);
  }

  // Throws EXPORT_EMPTY before anything is recorded when there is no data.
  const { filename, stream } = await streamSiteExport(ctx, input);
  const row = await ctx.prisma.siteExport.create({
    data: { websiteId: input.websiteId, requestedById: input.userId, filename, status: "RUNNING" },
  });

  void (async () => {
    try {
      await mkdir(EXPORTS_DIR, { recursive: true });
      await pipeline(stream, createWriteStream(partPath(row.id)));
      await rename(partPath(row.id), filePath(row.id));
      const { size } = await stat(filePath(row.id));
      const done = await ctx.prisma.siteExport
        .update({
          where: { id: row.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            expiresAt: new Date(Date.now() + EXPORT_TTL_DAYS * 86_400_000),
            sizeBytes: BigInt(size),
          },
        })
        .catch(() => null);
      // Deleted while it was being written: drop the file too.
      if (!done) return removeFiles(row.id);
      const requester = await ctx.prisma.user.findUnique({ where: { id: input.userId }, select: { email: true } });
      if (requester) {
        await sendEmail(
          exportReadyEmail(requester.email, {
            domain: input.domain,
            filename,
            settingsUrl: `${APP_URL}/sites/${encodeURIComponent(input.domain)}/settings?section=imports`,
            days: EXPORT_TTL_DAYS,
          }),
        );
      }
    } catch (error) {
      console.error(`[export] ${row.id} failed`, error);
      await removeFiles(row.id);
      await ctx.prisma.siteExport
        .update({ where: { id: row.id }, data: { status: "FAILED", error: "The export failed. Try again." } })
        .catch(() => null);
    }
  })();

  return serializeExport(row);
};

/** A completed, unexpired export's file, to stream to the browser. */
export const openSiteExport = async (ctx: AppContext, siteId: string, exportId: string) => {
  const row = await ctx.prisma.siteExport.findFirst({ where: { id: exportId, websiteId: siteId, status: "COMPLETED" } });
  if (!row || (row.expiresAt && row.expiresAt < new Date())) throw exportNotFound();
  const size = await stat(filePath(row.id)).then((s) => s.size).catch(() => null);
  if (size === null) throw exportNotFound();
  return { filename: row.filename, size, stream: createReadStream(filePath(row.id)) as Readable };
};

export const deleteSiteExport = async (ctx: AppContext, siteId: string, exportId: string) => {
  const row = await ctx.prisma.siteExport.findFirst({ where: { id: exportId, websiteId: siteId } });
  if (!row) throw exportNotFound();
  await ctx.prisma.siteExport.delete({ where: { id: row.id } });
  await removeFiles(row.id);
};

/**
 * Cron: delete expired exports with their files, fail exports a restart cut
 * off, and remove files no row points at (a deleted site cascades its rows,
 * not its files).
 */
export const cleanupSiteExports = async (ctx: AppContext, now: Date = new Date()) => {
  const expired = await ctx.prisma.siteExport.findMany({
    where: { status: "COMPLETED", expiresAt: { lt: now } },
    select: { id: true },
  });
  for (const { id } of expired) {
    await removeFiles(id);
    await ctx.prisma.siteExport.delete({ where: { id } }).catch(() => null);
  }
  const stale = await ctx.prisma.siteExport.findMany({
    where: { status: "RUNNING", createdAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) } },
    select: { id: true },
  });
  for (const { id } of stale) {
    await removeFiles(id);
    await ctx.prisma.siteExport
      .update({ where: { id }, data: { status: "FAILED", error: "The export was interrupted. Try again." } })
      .catch(() => null);
  }
  const files = await readdir(EXPORTS_DIR).catch(() => [] as string[]);
  const ids = new Set((await ctx.prisma.siteExport.findMany({ select: { id: true } })).map((r) => r.id));
  let orphans = 0;
  for (const name of files) {
    const id = name.replace(/\.zip(\.part)?$/, "");
    if (!ids.has(id)) {
      await rm(path.join(EXPORTS_DIR, name), { force: true });
      orphans++;
    }
  }
  return { expired: expired.length, stale: stale.length, orphans };
};
