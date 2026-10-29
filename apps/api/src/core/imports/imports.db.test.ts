/**
 * A whole GA4 import against real Postgres and ClickHouse, with Google
 * replaced by a fake source. Run with RUN_DB_TESTS=1.
 *
 * Uses its own ClickHouse client and an in-memory Redis stand-in, closed at
 * the end, so no process-wide handle keeps the test file alive.
 */
import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createClient } from "@clickhouse/client";
import prisma from "../../lib/prisma.js";
import type { AppContext } from "../../lib/context.js";
import { encryptSecret } from "../gsc/token-crypto.js";
import type { Ga4Source } from "./ga4-import.js";
import { deleteImport, processImport, processPendingImports } from "./imports.service.js";
import { getImportedWindow } from "./imported-window.js";
import { GA4_REPORTS } from "./ga4-reports.js";

const RUN = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const skip = RUN ? false : "set RUN_DB_TESTS=1 with DATABASE_URL to run";

const marker = `imports-${randomUUID()}`;
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

/** Every field offered; totals and pages return one row per day, the rest nothing. */
const fakeSource = (opts: { failWith?: Error } = {}): Ga4Source => ({
  metadata: async () => ({
    dimensions: new Set([
      "date",
      ...GA4_REPORTS.flatMap((r) => [...r.dimensions, ...(r.optionalDimensions ?? []), ...(r.filters ?? []).map((f) => f.fieldName)]),
    ]),
    metrics: new Set(GA4_REPORTS.flatMap((r) => [...r.metrics])),
  }),
  runReport: async (request) => {
    if (opts.failWith) throw opts.failWith;
    if (request.dimensions.length === 1) {
      return {
        rows: [
          // users, sessions, views, engagedSessions, averageSessionDuration
          { dimensions: ["20240101"], metrics: ["10", "12", "30", "6", "60"] },
          { dimensions: ["20240102"], metrics: ["5", "5", "10", "4", "30"] },
        ],
        rowCount: 2,
      };
    }
    if (request.dimensions[1] === "pagePath") {
      return { rows: [{ dimensions: ["20240101", "/pricing", "example.com"], metrics: ["4", "4", "6", "3", "40"] }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  },
});

const createImport = () =>
  prisma.siteImport.create({
    data: {
      websiteId: siteId,
      createdById: userId,
      propertyId: "123",
      propertyName: "Test property",
      startDate: new Date("2024-01-01T00:00:00Z"),
      endDate: new Date("2024-01-31T00:00:00Z"),
      refreshToken: encryptSecret("refresh-token"),
      stepsTotal: GA4_REPORTS.length,
    },
  });

const importedRows = async (importId: string) => {
  const result = await clickhouse.query({
    query: `SELECT family, page, hostname, toString(date) AS date, visitors, visits, bounces, visit_duration
            FROM webyz_analytics.imported_stats WHERE import_id = {importId:String} ORDER BY family, date`,
    query_params: { importId },
    format: "JSONEachRow",
  });
  return result.json<Record<string, string | number>>();
};

before(async () => {
  if (!RUN) return;
  const user = await prisma.user.create({ data: { name: marker, email: `${marker}@example.test`, provider: "email" } });
  userId = user.id;
  const site = await prisma.website.create({ data: { name: marker, domain: `${marker}.example.test`, userId } });
  siteId = site.id;
});

after(async () => {
  if (RUN) {
    const imports = await prisma.siteImport.findMany({ where: { websiteId: siteId }, select: { id: true } });
    for (const { id } of imports) {
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

test("an import writes labelled daily rows, completes, and drops the Google grant", { skip }, async () => {
  const row = await createImport();
  assert.equal(await processImport(ctx, row.id, () => fakeSource()), "done");

  const done = await prisma.siteImport.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(done.status, "COMPLETED");
  assert.equal(done.refreshToken, null);
  assert.equal(done.stepsDone, GA4_REPORTS.length);
  assert.ok(done.completedAt);

  const rows = await importedRows(row.id);
  const totals = rows.filter((r) => r.family === "visitors");
  assert.deepEqual(
    totals.map((r) => [r.date, Number(r.visitors), Number(r.visits), Number(r.bounces), Number(r.visit_duration)]),
    [
      ["2024-01-01", 10, 12, 6, 720],
      ["2024-01-02", 5, 5, 1, 150],
    ],
  );
  assert.ok(rows.some((r) => r.family === "pages" && r.page === "/pricing" && r.hostname === "example.com"));

  const window = await getImportedWindow(ctx, siteId);
  assert.deepEqual([window?.start, window?.end, window?.importIds], ["2024-01-01", "2024-01-31", [row.id]]);

  await deleteImport(ctx, siteId, row.id);
  assert.equal(await prisma.siteImport.findUnique({ where: { id: row.id } }), null);
  assert.deepEqual(await importedRows(row.id), []);
  assert.equal(await getImportedWindow(ctx, siteId), null);
});

test("a failed import keeps no rows and tells the owner what to do", { skip }, async () => {
  const row = await createImport();
  assert.equal(await processImport(ctx, row.id, () => fakeSource({ failWith: new Error("boom") })), "failed");
  const failed = await prisma.siteImport.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.refreshToken, null);
  assert.match(failed.error ?? "", /Delete it and try again/);
  assert.deepEqual(await importedRows(row.id), []);
  await prisma.siteImport.delete({ where: { id: row.id } });
});

test("an import is claimed once, and a stale run is resumed from scratch", { skip }, async () => {
  const row = await createImport();
  const [first, second] = await Promise.all([
    processImport(ctx, row.id, () => fakeSource()),
    processImport(ctx, row.id, () => fakeSource()),
  ]);
  assert.deepEqual([first, second].sort(), ["done", "skipped"]);
  const once = await importedRows(row.id);

  // Pretend a restart abandoned it mid-run: RUNNING with an old heartbeat.
  await prisma.siteImport.update({
    where: { id: row.id },
    data: { status: "RUNNING", heartbeatAt: new Date(Date.now() - 60 * 60_000), refreshToken: encryptSecret("refresh-token") },
  });
  const results = await processPendingImports(ctx, () => fakeSource());
  assert.ok(results.includes("done"));
  // The resumed run deleted the first attempt's rows before writing again.
  assert.equal((await importedRows(row.id)).length, once.length);

  await deleteImport(ctx, siteId, row.id);
});
