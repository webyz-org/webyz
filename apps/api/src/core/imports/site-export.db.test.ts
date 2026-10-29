/**
 * "Export data" end to end against real Postgres and ClickHouse: prepare,
 * download, delete, expire. Run with RUN_DB_TESTS=1. Files go to a temporary
 * EXPORTS_DIR; own ClickHouse client, closed at the end.
 */
import "dotenv/config";
import { mkdtempSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const dir = mkdtempSync(path.join(tmpdir(), "webyz-exports-"));
process.env.EXPORTS_DIR = dir;

const { createClient } = await import("@clickhouse/client");
const { default: prisma } = await import("../../lib/prisma.js");
const service = await import("./site-export.service.js");
type Ctx = import("../../lib/context.js").AppContext;

const RUN = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const skip = RUN ? false : "set RUN_DB_TESTS=1 with DATABASE_URL to run";

const marker = `export-${randomUUID()}`;
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL ?? process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});
const ctx = { prisma, clickhouse, redis: {} } as unknown as Ctx;
let userId = "";
let siteId = "";
const domain = `${marker}.example.test`;

const range = { from: Date.parse("2026-01-01T00:00:00Z") / 1000, to: Date.parse("2026-02-01T00:00:00Z") / 1000 };

const waitFor = async (id: string, status: string) => {
  for (let i = 0; i < 100; i++) {
    const row = await prisma.siteExport.findUnique({ where: { id } });
    if (row?.status === status) return row;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`export ${id} never reached ${status}`);
};

before(async () => {
  if (!RUN) return;
  userId = (await prisma.user.create({ data: { name: marker, email: `${marker}@example.test`, provider: "email" } })).id;
  siteId = (await prisma.website.create({ data: { name: marker, domain, userId, timezone: "UTC" } })).id;
  // One tracked visit: a session and its pageview.
  await clickhouse.insert({
    table: "webyz_analytics.sessions",
    format: "JSONEachRow",
    values: [
      {
        session_id: `${marker}-s`, website_id: siteId, user_id: `${marker}-u`,
        start_time: "2026-01-10 10:00:00", end_time: "2026-01-10 10:01:00", duration_seconds: 60,
        page_views: 1, events: 1, entry_page: "/", exit_page: "/", country: "DE",
        browser_family: "Firefox", browser_version: "129.0.1", os_family: "Linux", device_type: "desktop",
        updated_at: "2026-01-10 10:01:00",
      },
    ],
    clickhouse_settings: { input_format_defaults_for_omitted_fields: 1 },
  });
  await clickhouse.insert({
    table: "webyz_analytics.events",
    format: "JSONEachRow",
    values: [
      {
        event_id: `${marker}-e`, website_id: siteId, session_id: `${marker}-s`, user_id: `${marker}-u`,
        event_type: "pageview", event_name: "", timestamp: "2026-01-10 10:00:00", url_path: "/", hostname: domain,
      },
    ],
    clickhouse_settings: { input_format_defaults_for_omitted_fields: 1 },
  });
});

after(async () => {
  if (RUN) {
    for (const table of ["sessions", "events"]) {
      await clickhouse.command({
        query: `ALTER TABLE webyz_analytics.${table} DELETE WHERE website_id = {s:String}`,
        query_params: { s: siteId },
      });
    }
    await prisma.user.deleteMany({ where: { id: userId } });
  }
  await clickhouse.close();
  await prisma.$disconnect();
});

test("Export to CSV prepares a zip, downloads it, and deletes it with its file", { skip }, async () => {
  const started = await service.requestSiteExport(ctx, { websiteId: siteId, domain, timezone: "UTC", userId, ...range });
  assert.equal(started.status, "running");
  assert.match(started.filename, /^export-.*_example_test_\d{8}\.zip$/);

  const done = await waitFor(started.id, "COMPLETED");
  assert.ok(done.expiresAt && done.expiresAt.getTime() - Date.now() > 6.9 * 86_400_000);
  const zip = readFileSync(path.join(dir, `${started.id}.zip`));
  assert.equal(Number(done.sizeBytes), zip.length);
  const text = zip.toString("latin1");
  assert.ok(text.includes("imported_visitors_20260110_20260110.csv"));
  assert.ok(text.includes('"2026-01-10",1,1,1,1,60'), "one visitor, one pageview, one bounce, one visit, 60 s");
  assert.ok(text.includes('"Firefox","129.0"'), "versions major.minor");

  const file = await service.openSiteExport(ctx, siteId, started.id);
  assert.equal(file.size, zip.length);
  file.stream.destroy();
  assert.equal((await service.getSiteExport(ctx, siteId))?.status, "completed");

  await service.deleteSiteExport(ctx, siteId, started.id);
  assert.equal(existsSync(path.join(dir, `${started.id}.zip`)), false);
  assert.equal(await service.getSiteExport(ctx, siteId), null);
  await assert.rejects(service.openSiteExport(ctx, siteId, started.id), /not available/);
});

test("a new export replaces the old one", { skip }, async () => {
  const first = await service.requestSiteExport(ctx, { websiteId: siteId, domain, timezone: "UTC", userId, ...range });
  await waitFor(first.id, "COMPLETED");
  const second = await service.requestSiteExport(ctx, { websiteId: siteId, domain, timezone: "UTC", userId, ...range });
  await waitFor(second.id, "COMPLETED");
  assert.equal(await prisma.siteExport.count({ where: { websiteId: siteId } }), 1);
  assert.equal(existsSync(path.join(dir, `${first.id}.zip`)), false);
  await service.deleteSiteExport(ctx, siteId, second.id);
});

test("cleanup expires files after seven days, fails interrupted ones, removes strays", { skip }, async () => {
  const done = await service.requestSiteExport(ctx, { websiteId: siteId, domain, timezone: "UTC", userId, ...range });
  await waitFor(done.id, "COMPLETED");
  const stuck = await prisma.siteExport.create({
    data: { websiteId: siteId, filename: "stuck.zip", status: "RUNNING", createdAt: new Date(Date.now() - 2 * 3_600_000) },
  });
  writeFileSync(path.join(dir, "stray.zip"), "x");

  const result = await service.cleanupSiteExports(ctx, new Date(Date.now() + 8 * 86_400_000));
  assert.deepEqual([result.expired, result.stale, result.orphans], [1, 1, 1]);
  assert.equal(await prisma.siteExport.findUnique({ where: { id: done.id } }), null);
  assert.equal((await prisma.siteExport.findUniqueOrThrow({ where: { id: stuck.id } })).status, "FAILED");
  assert.deepEqual(readdirSync(dir), []);
  await prisma.siteExport.delete({ where: { id: stuck.id } });
});

test("a site with no tracked data has nothing to export", { skip }, async () => {
  const empty = await prisma.website.create({ data: { name: `${marker}-empty`, domain: `empty-${domain}`, userId } });
  await assert.rejects(
    service.requestSiteExport(ctx, { websiteId: empty.id, domain: empty.domain, timezone: "UTC", userId, ...range }),
    /no tracked data/,
  );
  assert.equal(await prisma.siteExport.count({ where: { websiteId: empty.id } }), 0);
});
