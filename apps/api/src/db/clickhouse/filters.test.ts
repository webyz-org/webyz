import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSessionFilters,
  formatFilterValue,
  parseFilterValue,
} from "./filters.js";

describe("filter value wire format", () => {
  it("reads a bare value as equality", () => {
    assert.deepEqual(parseFilterValue("/pricing"), { op: "is", value: "/pricing" });
  });

  it("reads the operator prefixes", () => {
    assert.deepEqual(parseFilterValue("!Chrome"), { op: "is_not", value: "Chrome" });
    assert.deepEqual(parseFilterValue("~blog"), { op: "contains", value: "blog" });
    assert.deepEqual(parseFilterValue("!~admin"), { op: "not_contains", value: "admin" });
  });

  it("escapes a literal that starts with an operator character", () => {
    assert.deepEqual(parseFilterValue("=!important"), { op: "is", value: "!important" });
    assert.equal(formatFilterValue({ op: "is", value: "~tilde" }), "=~tilde");
  });

  it("rejects an empty value", () => {
    assert.equal(parseFilterValue(""), null);
    assert.equal(parseFilterValue("!"), null);
  });

  it("round-trips every operator, including values that look like operators", () => {
    for (const op of ["is", "is_not", "contains", "not_contains"] as const) {
      for (const value of ["Safari 17", "~tilde", "!bang", "=eq", "!~both"]) {
        const condition = { op, value };
        assert.deepEqual(parseFilterValue(formatFilterValue(condition)), condition);
      }
    }
    assert.equal(formatFilterValue({ op: "is_not", value: "~x" }), "!=~x");
  });
});

describe("buildSessionFilters", () => {
  it("binds every value as a parameter and never inlines it", () => {
    const params: Record<string, unknown> = {};
    const built = buildSessionFilters(
      { browser: { op: "is", value: "Chrome'; DROP TABLE sessions; --" } },
      params,
    );
    assert.equal(params.flt_browser, "Chrome'; DROP TABLE sessions; --");
    assert.deepEqual(built.clauses, ["browser_family = {flt_browser:String}"]);
    assert.ok(!built.clauses[0].includes("DROP"));
  });

  it("emits one predicate per operator", () => {
    const params: Record<string, unknown> = {};
    const built = buildSessionFilters(
      {
        browser: { op: "is_not", value: "Chrome" },
        entry_page: { op: "contains", value: "blog" },
        city: { op: "not_contains", value: "x" },
      },
      params,
    );
    assert.deepEqual(built.clauses, [
      "browser_family != {flt_browser:String}",
      "positionCaseInsensitive(entry_page, {flt_entry_page:String}) > 0",
      "positionCaseInsensitive(city, {flt_city:String}) = 0",
    ]);
    assert.deepEqual(built.columns, ["browser_family", "entry_page", "city"]);
  });

  it("turns page and event filters into events-table restrictions", () => {
    const params: Record<string, unknown> = {};
    const built = buildSessionFilters(
      {
        page: { op: "is_not", value: "/" },
        event: { op: "contains", value: "sign" },
      },
      params,
    );
    assert.equal(built.clauses.length, 0);
    assert.match(built.pageRestriction, /session_id NOT IN \([\s\S]*url_path = \{flt_page:String\}/);
    assert.match(
      built.pageRestriction,
      /session_id IN \([\s\S]*positionCaseInsensitive\(event_name, \{flt_event:String\}\) > 0/,
    );
    assert.equal(params.flt_page, "/");
    assert.equal(params.flt_event, "sign");
  });

  it("ignores unknown keys", () => {
    const params: Record<string, unknown> = {};
    const built = buildSessionFilters(
      { nope: { op: "is", value: "x" } } as never,
      params,
    );
    assert.deepEqual(built, { columns: [], clauses: [], pageRestriction: "" });
    assert.deepEqual(params, {});
  });
});
