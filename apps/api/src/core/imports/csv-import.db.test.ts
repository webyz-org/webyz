/**
 * A CSV import upload (Plausible's format) against real Postgres and ClickHouse. Run with
 * RUN_DB_TESTS=1. Own ClickHouse client and an in-memory Redis stand-in,
 * closed at the end, so no process-wide handle keeps the file alive.
 */
import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createClient } from "@clickhouse/client";
import prisma from "../../lib/prisma.js";
import type { AppContext } from "../../lib/context.js";
import {
  completeCsvImport,
  failStaleCsvImports,
  startCsvImport,
  uploadCsvChunk,
} from "./csv-import.service.js";
import { getImportedWindow } from "./imported-window.js";
import { MAX_IMPORTS, deleteImport } from "./imports.service.js";

const RUN = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const skip = RUN ? false : "set RUN_DB_TESTS=1 with DATABASE_URL to run";

const marker = `plausible-${randomUUID()}`;
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL ?? process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});
const store = new Map<string, string>();
const redis = {
  get: async (k: string) => store.get(k) ?? null,
  setex: async (k: string, _ttl: number, v: string) => void store.set(k, v),
  del: async (k: string) => (store.delete(k) ? 1 : 0),
};
const ctx = { prisma, clickhouse, redis } as unknown as AppContext;

let userId = "";
let siteId = "";

const VISITORS = "imported_visitors_20240101_20240131.csv";
const SOURCES = "imported_sources_20240101_20240131.csv";
const visitorsHeader = "date,visitors,pageviews,bounces,visits,visit_duration";

const totals = async (importId: string) => {
  const result = await clickhouse.query({
    query: `SELECT toUInt32(sum(visitors)) AS v, toUInt32(count()) AS n FROM webyz_analytics.imported_stats
            WHERE import_id = {importId:String} AND family = 'visitors'`,
    query_params: { importId },
    format: "JSONEachRow",
  });
  const [row] = await result.json<{ v: number; n: number }>();
  return { visitors: Number(row.v), rows: Number(row.n) };
};

before(async () => {
  if (!RUN) return;
  const user = await prisma.user.create({ data: { name: marker, email: `${marker}@example.test`, provider: "email" } });
  userId = user.id;
  siteId = (await prisma.website.create({ data: { name: marker, domain: `${marker}.example.test`, userId } })).id;
});

after(async () => {
  if (RUN) {
    for (const { id } of await prisma.siteImport.findMany({ where: { websiteId: siteId }, select: { id: true } })) {
      await clickhouse.command({
        query: "ALTER TABLE webyz_analytics.imported_stats DELETE WHERE import_id = {id:String}",
        query_params: { id },
      });
    }
    await prisma.user.deleteMany({ where: { id: userId } });
  }
  await clickhouse.close();
  await prisma.$disconnect();
});

test("an upload writes each chunk once and completes into the dashboard window", { skip }, async () => {
  const started = await startCsvImport(ctx, {
    siteId,
    timezone: "UTC",
    userId,
    files: [VISITORS, SOURCES],
    name: "example_com_20240201.zip",
    chunks: 3,
  });
  assert.equal(started.status, "running");
  assert.deepEqual([started.start_date, started.end_date], ["2024-01-01", "2024-01-31"]);

  const first = `${visitorsHeader}\n2024-01-01,10,20,3,12,600\n`;
  assert.equal((await uploadCsvChunk(ctx, { siteId, importId: started.id, file: VISITORS, index: 0, csv: first })).rows, 1);
  // A retried chunk is acknowledged and not written again.
  assert.equal((await uploadCsvChunk(ctx, { siteId, importId: started.id, file: VISITORS, index: 0, csv: first })).duplicate, true);
  await uploadCsvChunk(ctx, { siteId, importId: started.id, file: VISITORS, index: 1, csv: `${visitorsHeader}\n2024-01-02,5,5,1,5,50\n` });
  await uploadCsvChunk(ctx, {
    siteId,
    importId: started.id,
    file: SOURCES,
    index: 0,
    csv: "date,source,referrer,utm_source,utm_medium,utm_campaign,utm_content,utm_term,pageviews,visitors,visits,visit_duration,bounces\n2024-01-01,Google,google.com,,,,,,5,4,4,100,1\n",
  });

  assert.deepEqual(await totals(started.id), { visitors: 15, rows: 2 });

  const done = await completeCsvImport(ctx, siteId, started.id);
  assert.equal(done.status, "completed");
  // Two visitors rows and one sources row, its channel and source in one row.
  assert.equal(done.rows_imported, 1 + 1 + 1);
  const window = await getImportedWindow(ctx, siteId);
  assert.deepEqual([window?.start, window?.end, window?.importIds], ["2024-01-01", "2024-01-31", [started.id]]);

  await assert.rejects(
    uploadCsvChunk(ctx, { siteId, importId: started.id, file: VISITORS, index: 2, csv: first }),
    /not accepting files/,
  );

  await deleteImport(ctx, siteId, started.id);
  assert.deepEqual(await totals(started.id), { visitors: 0, rows: 0 });
});

test("an export without the visitors file is refused before anything is written", { skip }, async () => {
  await assert.rejects(
    startCsvImport(ctx, { siteId, timezone: "UTC", userId, files: [SOURCES], chunks: 1 }),
    /imported_visitors/,
  );
  await assert.rejects(
    startCsvImport(ctx, { siteId, timezone: "UTC", userId, files: [VISITORS, "notes.csv"], chunks: 1 }),
    /Not an import file: notes.csv/,
  );
});

test("an abandoned upload fails after an hour and leaves no rows", { skip }, async () => {
  const started = await startCsvImport(ctx, { siteId, timezone: "UTC", userId, files: [VISITORS], chunks: 2 });
  await uploadCsvChunk(ctx, { siteId, importId: started.id, file: VISITORS, index: 0, csv: `${visitorsHeader}\n2024-01-03,7,7,0,7,0\n` });
  await prisma.siteImport.update({ where: { id: started.id }, data: { heartbeatAt: new Date(Date.now() - 2 * 60 * 60_000) } });

  assert.ok((await failStaleCsvImports(ctx)) >= 1);
  const failed = await prisma.siteImport.findUniqueOrThrow({ where: { id: started.id } });
  assert.equal(failed.status, "FAILED");
  assert.match(failed.error ?? "", /upload the export again/);
  assert.deepEqual(await totals(started.id), { visitors: 0, rows: 0 });
  await prisma.siteImport.delete({ where: { id: started.id } });
});

test("several imports sit side by side, but never on the same day", { skip }, async () => {
  const january = await startCsvImport(ctx, { siteId, timezone: "UTC", userId, files: [VISITORS], chunks: 1 });
  await uploadCsvChunk(ctx, { siteId, importId: january.id, file: VISITORS, index: 0, csv: `${visitorsHeader}\n2024-01-05,3,3,0,3,0\n` });
  await completeCsvImport(ctx, siteId, january.id);

  const MARCH = "imported_visitors_20240301_20240331.csv";
  const march = await startCsvImport(ctx, { siteId, timezone: "UTC", userId, files: [MARCH], chunks: 1 });
  await uploadCsvChunk(ctx, { siteId, importId: march.id, file: MARCH, index: 0, csv: `${visitorsHeader}\n2024-03-05,4,4,0,4,0\n` });
  await completeCsvImport(ctx, siteId, march.id);

  // One span covers both; the February gap simply has no imported rows.
  store.clear();
  const window = await getImportedWindow(ctx, siteId);
  assert.deepEqual([window?.start, window?.end], ["2024-01-01", "2024-03-31"]);
  assert.deepEqual(window?.importIds.sort(), [january.id, march.id].sort());

  await assert.rejects(
    startCsvImport(ctx, { siteId, timezone: "UTC", userId, files: ["imported_visitors_20240115_20240215.csv"], chunks: 1 }),
    /overlap an existing import \(2024-01-01 to 2024-01-31\)/,
  );

  await deleteImport(ctx, siteId, january.id);
  await deleteImport(ctx, siteId, march.id);
});

test(`a site holds at most ${MAX_IMPORTS} imports at a time`, { skip }, async () => {
  const ids: string[] = [];
  for (let month = 1; month <= MAX_IMPORTS; month++) {
    const mm = String(month).padStart(2, "0");
    const file = `imported_visitors_2023${mm}01_2023${mm}28.csv`;
    ids.push((await startCsvImport(ctx, { siteId, timezone: "UTC", userId, files: [file], chunks: 1 })).id);
  }
  await assert.rejects(
    startCsvImport(ctx, { siteId, timezone: "UTC", userId, files: ["imported_visitors_20231001_20231031.csv"], chunks: 1 }),
    /up to 5 imports/,
  );
  for (const id of ids) await deleteImport(ctx, siteId, id);
});
