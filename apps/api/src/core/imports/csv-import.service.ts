import { AppContext } from "../../lib/context.js";
import { badRequest } from "../../errors/http-errors.js";
import { importNotFound, importNothingToImport } from "../../errors/domain-errors.js";
import { deleteImportedRows, firstTrackedDate, insertImportedRows } from "../../db/clickhouse/imported.js";
import { addDays, localToday } from "./dates.js";
import { getGeoNames } from "./geo-names.js";
import { invalidateImportedWindow } from "./imported-window.js";
import { mapPlausibleRows, parseCsv, parsePlausibleFilename } from "./plausible-csv.js";
import { assertImportSlot, serializeImport } from "./imports.service.js";

/**
 * CSV import, for any tool that writes Plausible's import format (Plausible's
 * own export does; docs/importing.md documents it for everything else).
 * Unlike GA4 there is no credential and no job: the browser unpacks a zip if
 * it was given one and uploads each CSV in chunks
 * small enough for any reverse proxy, every chunk carrying the header row,
 * and each chunk is mapped and written as it arrives. Finishing the upload
 * completes the import. An upload abandoned halfway fails after an hour of
 * silence and its rows are removed (`failStaleCsvImports`).
 */

/**
 * Most characters of CSV accepted in one chunk. The dashboard sends 240,000
 * (`features/imports/csvFiles.ts`), under the 1 MB ceiling of the hosted proxy
 * and the 2 MB import route of the bundled Caddy and example nginx.
 */
export const CSV_CHUNK_LIMIT = 1_000_000;
const STALE_AFTER_MS = 60 * 60_000;

const isVisitors = (filename: string) => parsePlausibleFilename(filename)?.report === "imported_visitors";

export const startCsvImport = async (
  ctx: AppContext,
  input: { siteId: string; timezone: string; userId: string; files: string[]; name?: string; chunks: number },
) => {
  const parsed = input.files.map((file) => ({ file, meta: parsePlausibleFilename(file) }));
  const unknown = parsed.filter((p) => !p.meta).map((p) => p.file);
  if (unknown.length) {
    throw badRequest(
      `Not an import file: ${unknown.join(", ")}. Files are named imported_<report>_YYYYMMDD_YYYYMMDD.csv`,
      { files: unknown },
    );
  }
  if (!input.files.some(isVisitors)) {
    throw badRequest("The export must include the imported_visitors file, which carries the site totals.");
  }

  const starts = parsed.map((p) => p.meta!.start).sort();
  const ends = parsed.map((p) => p.meta!.end).sort();
  const yesterday = addDays(localToday(input.timezone), -1);
  const firstTracked = await firstTrackedDate(ctx.clickhouse, input.siteId, input.timezone);
  const endCandidates = [ends[ends.length - 1], yesterday];
  if (firstTracked) endCandidates.push(addDays(firstTracked, -1));
  const endDate = endCandidates.sort()[0];
  const startDate = starts[0];
  if (startDate > endDate) {
    if (firstTracked) throw importNothingToImport(firstTracked);
    throw badRequest("The files cover no day before today");
  }
  await assertImportSlot(ctx, input.siteId, { start: startDate, end: endDate });

  const now = new Date();
  const row = await ctx.prisma.siteImport.create({
    data: {
      websiteId: input.siteId,
      createdById: input.userId,
      source: "csv",
      propertyId: "export",
      propertyName: input.name?.slice(0, 200) || "CSV import",
      startDate: new Date(`${startDate}T00:00:00Z`),
      endDate: new Date(`${endDate}T00:00:00Z`),
      status: "RUNNING",
      stepsTotal: Math.max(1, Math.floor(input.chunks)),
      startedAt: now,
      heartbeatAt: now,
    },
  });
  return serializeImport(row);
};

const runningCsvImport = async (ctx: AppContext, siteId: string, importId: string) => {
  const row = await ctx.prisma.siteImport.findFirst({ where: { id: importId, websiteId: siteId, source: "csv" } });
  if (!row) throw importNotFound();
  if (row.status !== "RUNNING") throw badRequest(`This import is ${row.status.toLowerCase()}, not accepting files`);
  return row;
};

/**
 * Map and write one chunk. A chunk already written (a retry after a dropped
 * response) is acknowledged without writing it again.
 */
export const uploadCsvChunk = async (
  ctx: AppContext,
  input: { siteId: string; importId: string; file: string; index: number; csv: string },
) => {
  const row = await runningCsvImport(ctx, input.siteId, input.importId);
  const meta = parsePlausibleFilename(input.file);
  if (!meta) throw badRequest(`Not an import file: ${input.file}`);
  if (!Number.isInteger(input.index) || input.index < 0) throw badRequest("index must be a whole number");
  if (input.csv.length > CSV_CHUNK_LIMIT * 1.1) throw badRequest("Chunk too large");

  const key = `${input.file}#${input.index}`;
  if (row.chunksDone.includes(key)) return { rows: 0, duplicate: true };

  const { header, rows } = parseCsv(input.csv);
  if (!header.includes("date")) throw badRequest(`${input.file}: the chunk has no header row with a date column`);
  const geo = meta.report === "imported_locations" ? await getGeoNames() : null;
  const mapped = mapPlausibleRows(
    meta.report,
    header,
    rows,
    { from: row.startDate.toISOString().slice(0, 10), to: row.endDate.toISOString().slice(0, 10) },
    geo,
  );

  await insertImportedRows(
    ctx.clickhouse,
    mapped.map((r) => ({ ...r, website_id: row.websiteId, import_id: row.id })),
  );
  const skippedGeo =
    meta.report === "imported_locations" && !geo && !row.skipped.includes("Regions and cities")
      ? { skipped: { push: "Regions and cities" } }
      : {};
  await ctx.prisma.siteImport.update({
    where: { id: row.id },
    data: {
      chunksDone: { push: key },
      rowsImported: { increment: mapped.length },
      stepsDone: { increment: 1 },
      heartbeatAt: new Date(),
      ...skippedGeo,
    },
  });
  return { rows: mapped.length, duplicate: false };
};

export const completeCsvImport = async (ctx: AppContext, siteId: string, importId: string) => {
  const row = await runningCsvImport(ctx, siteId, importId);
  if (!row.chunksDone.some((key) => isVisitors(key.split("#")[0]))) {
    throw badRequest("The imported_visitors file has not been uploaded yet.");
  }
  const done = await ctx.prisma.siteImport.update({
    where: { id: row.id },
    data: { status: "COMPLETED", completedAt: new Date(), stepsDone: row.stepsTotal },
  });
  await invalidateImportedWindow(ctx, siteId);
  return serializeImport(done);
};

/** Cron: an upload silent for an hour was abandoned; fail it and drop its rows. */
export const failStaleCsvImports = async (ctx: AppContext) => {
  const stale = await ctx.prisma.siteImport.findMany({
    where: { source: "csv", status: "RUNNING", heartbeatAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
    select: { id: true },
  });
  for (const { id } of stale) {
    await ctx.prisma.siteImport.update({
      where: { id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        error: "The upload stopped before every file arrived. Delete this import and upload the export again.",
      },
    });
    await deleteImportedRows(ctx.clickhouse, id);
  }
  return stale.length;
};
