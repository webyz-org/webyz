import "dotenv/config";
import assert from "node:assert/strict";
import { after, describe, it, test } from "node:test";

import { createClient } from "@clickhouse/client";
import { VERSION_SQL, buildSessionFilters } from "../db/clickhouse/filters.js";
import { shortVersion, shortVersionLabel } from "./version.js";

/** Input -> major.minor label, shared by the TS rule and the SQL rule. */
const CASES: Array<[string, string]> = [
  ["128.0.0.0", "128.0"],
  ["128.0.6613.120", "128.0"],
  ["128.0", "128.0"],
  ["17.6", "17.6"],
  ["10.15.7", "10.15"],
  ["14", "14"],
  ["10", "10"],
  [" 120.1.2 ", "120.1"],
  ["Unknown", "Unknown"],
  ["", ""],
  ["XP", "XP"],
];

describe("shortVersion", () => {
  it("cuts every source's version to major.minor", () => {
    for (const [input, expected] of CASES) assert.equal(shortVersion(input), expected, input);
  });

  it("normalises a rendered label, browser names with spaces included", () => {
    assert.equal(shortVersionLabel("Chrome 128.0.0.0"), "Chrome 128.0");
    assert.equal(shortVersionLabel("Microsoft Edge 128.0.2739.42"), "Microsoft Edge 128.0");
    assert.equal(shortVersionLabel("macOS 10.15.7"), "macOS 10.15");
    assert.equal(shortVersionLabel("Chrome Unknown"), "Chrome Unknown");
    assert.equal(shortVersionLabel("Safari 17.6"), "Safari 17.6");
  });

  it("matches an old full-version filter value against the new label", () => {
    const params: Record<string, unknown> = {};
    buildSessionFilters({ browser_version: { op: "is", value: "Chrome 128.0.0.0" } }, params);
    assert.equal(params.flt_browser_version, "Chrome 128.0");
    const contains: Record<string, unknown> = {};
    buildSessionFilters({ browser_version: { op: "contains", value: "128.0.0" } }, contains);
    assert.equal(contains.flt_browser_version, "128.0.0");
  });
});

const RUN = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
const clickhouse = RUN
  ? createClient({
      url: process.env.CLICKHOUSE_URL ?? process.env.CLICKHOUSE_HOST,
      username: process.env.CLICKHOUSE_USER,
      password: process.env.CLICKHOUSE_PASSWORD,
    })
  : null;

after(async () => {
  await clickhouse?.close();
});

test("the SQL rule gives exactly what the TS rule gives", { skip: RUN ? false : "set RUN_DB_TESTS=1 to run" }, async () => {
  const result = await clickhouse!.query({
    query: `SELECT v, ${VERSION_SQL("v")} AS short FROM (SELECT arrayJoin({inputs:Array(String)}) AS v)`,
    query_params: { inputs: CASES.map(([input]) => input) },
    format: "JSONEachRow",
  });
  const rows = await result.json<{ v: string; short: string }>();
  assert.deepEqual(
    rows.map((r) => [r.v, r.short]),
    CASES.map(([input]) => [input, shortVersion(input)]),
  );
});
