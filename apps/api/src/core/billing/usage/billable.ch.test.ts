/**
 * The billable-event predicate against a real ClickHouse.
 *
 * Run with RUN_DB_TESTS=1. Uses CLICKHOUSE_URL from .env but its own database
 * (webyz_test), created here from the events migration, so dev data is never
 * touched. Skipped otherwise.
 */
import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type ClickHouseClient } from "@clickhouse/client";

import { countBillableEvents, countBillableEventsByHour } from "./billable.js";

const RUN = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
const skip = RUN ? false : "set RUN_DB_TESTS=1 with CLICKHOUSE_URL to run";
const TEST_DB = "webyz_test";

let ch: ClickHouseClient;
const site = `site-${randomUUID()}`;
const otherSite = `site-${randomUUID()}`;

const row = (over: Record<string, unknown>) => ({
  event_id: randomUUID(),
  website_id: site,
  session_id: "s1",
  user_id: "u1",
  event_type: "pageview",
  event_name: "pageview",
  timestamp: "2026-09-06 11:15:00",
  url_path: "/",
  url_query: "",
  referrer_path: "",
  referrer_query: "",
  referrer_domain: "",
  page_title: "",
  hostname: "example.com",
  browser: "",
  os: "",
  device_type: "",
  screen: "",
  language: "",
  country: "  ",
  sub_division_1: "",
  sub_division_2: "",
  city: "",
  utm_source: "",
  utm_medium: "",
  utm_campaign: "",
  utm_content: "",
  utm_term: "",
  "meta.key": [],
  "meta.value": [],
  ...over,
});

before(async () => {
  if (!RUN) return;
  const url = process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST!;
  const admin = createClient({ url, username: process.env.CLICKHOUSE_USER || "default", password: process.env.CLICKHOUSE_PASSWORD || "" });
  await admin.command({ query: `CREATE DATABASE IF NOT EXISTS ${TEST_DB}` });
  await admin.close();

  ch = createClient({ url, username: process.env.CLICKHOUSE_USER || "default", password: process.env.CLICKHOUSE_PASSWORD || "", database: TEST_DB });

  const ddl = readFileSync(
    path.join(import.meta.dirname, "../../../../clickhouse/migrations/002_create_events_table.sql"),
    "utf8",
  ).replace(/webyz_analytics\./g, `${TEST_DB}.`).replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS");
  await ch.command({ query: ddl });

  await ch.insert({
    table: "events",
    format: "JSONEachRow",
    values: [
      row({ timestamp: "2026-09-05 09:59:59" }), // before period start
      row({ timestamp: "2026-09-05 10:00:00" }), // period start, inclusive
      row({ timestamp: "2026-09-06 11:15:00" }),
      row({ timestamp: "2026-09-06 11:45:00", event_type: "event", event_name: "signup" }), // custom event counts
      row({ timestamp: "2026-09-06 11:50:00", hostname: "localhost" }), // never billable
      row({ timestamp: "2026-09-06 11:51:00", hostname: "127.0.0.1" }), // never billable
      row({ timestamp: "2026-09-06 11:52:00", hostname: "LOCALHOST" }), // case-insensitive
      row({ timestamp: "2026-09-06 11:55:00", event_type: "heartbeat", event_name: "heartbeat" }), // not a billable type
      row({ timestamp: "2026-09-06 12:05:00" }),
      row({ timestamp: "2026-09-06 12:06:00", website_id: otherSite }), // someone else's site
      row({ timestamp: "2026-10-05 10:00:00" }), // period end, exclusive
    ],
  });
});

after(async () => {
  if (!RUN) return;
  await ch.command({ query: `ALTER TABLE events DELETE WHERE website_id IN ('${site}', '${otherSite}')` }).catch(() => {});
  await ch.close();
});

const from = new Date("2026-09-05T10:00:00Z");
const to = new Date("2026-10-05T10:00:00Z");

test("counts pageviews and custom events, excludes dev hosts, other types, other sites and boundaries", { skip }, async () => {
  const total = await countBillableEvents(ch, [site], from, to);
  // 10:00 start, 11:15, 11:45 custom, 12:05 -> 4
  assert.equal(total, 4);
});

test("hourly rows group the same events by UTC hour", { skip }, async () => {
  const rows = await countBillableEventsByHour(ch, [site], from, to);
  assert.deepEqual(
    rows.map((r) => [r.hour.toISOString(), r.count]),
    [
      ["2026-09-05T10:00:00.000Z", 1],
      ["2026-09-06T11:00:00.000Z", 2],
      ["2026-09-06T12:00:00.000Z", 1],
    ],
  );
});

test("multiple sites are summed and an empty site list is zero without a query", { skip }, async () => {
  assert.equal(await countBillableEvents(ch, [site, otherSite], from, to), 5);
  assert.equal(await countBillableEvents(ch, [], from, to), 0);
  assert.deepEqual(await countBillableEventsByHour(ch, [], from, to), []);
});
