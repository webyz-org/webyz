import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyImported, importedScope, importedStatus, readFor } from "./imported-window.js";

const window = { start: "2024-01-01", end: "2024-03-31", importIds: ["imp-1"] };
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const is = (value: string) => ({ op: "is" as const, value });

describe("importedScope", () => {
  it("clips the request window to the imported days, end exclusive", () => {
    assert.deepEqual(importedScope(window, utc("2023-12-01"), utc("2024-02-01"), "UTC"), { from: "2024-01-01", to: "2024-02-01" });
    assert.deepEqual(importedScope(window, utc("2024-03-01"), utc("2024-05-01"), "UTC"), { from: "2024-03-01", to: "2024-04-01" });
  });

  it("is empty when the window does not touch an imported day", () => {
    assert.equal(importedScope(window, utc("2024-04-01"), utc("2024-05-01"), "UTC"), null);
    assert.equal(importedScope(null, utc("2024-01-01"), utc("2024-02-01"), "UTC"), null);
  });

  it("reads local dates in the site's timezone", () => {
    const from = Date.parse("2024-03-30T18:30:00Z") / 1000;
    const to = Date.parse("2024-04-01T18:30:00Z") / 1000;
    assert.deepEqual(importedScope(window, from, to, "Asia/Kolkata"), { from: "2024-03-31", to: "2024-04-01" });
  });
});

describe("applyImported, readFor and importedStatus", () => {
  const range = [utc("2024-01-01"), utc("2024-02-01")] as const;
  const access = { window, disabled: false };

  it("plans each report against the request's filters", () => {
    const applied = applyImported(access, ...range, "UTC", { country: is("IN") });
    assert.equal(readFor(applied.context, "region")?.plan.family, "locations");
    // Only completed imports' rows are read.
    assert.deepEqual(readFor(applied.context, "region")?.importIds, ["imp-1"]);
    assert.equal(readFor(applied.context, "browser"), null);
    assert.equal(importedStatus(applied, "region"), "included");
    assert.equal(importedStatus(applied, "browser"), "excluded_filters");
  });

  it("lets a report override the filters it plans with", () => {
    const applied = applyImported(access, ...range, "UTC", { outbound_domain: is("github.com"), country: is("IN") });
    assert.equal(readFor(applied.context, null), null);
    assert.equal(readFor(applied.context, null, { country: is("IN") })?.plan.family, "locations");
  });

  it("reports off when the request turned merging off, and nothing out of range", () => {
    const off = applyImported({ window, disabled: true }, ...range, "UTC", {});
    assert.equal(importedStatus(off, null), "off");
    assert.equal(off.context, null);
    const outside = applyImported(access, utc("2025-01-01"), utc("2025-02-01"), "UTC", {});
    assert.equal(importedStatus(outside, null), undefined);
  });
});
