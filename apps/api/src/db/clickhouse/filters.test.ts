import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OUTBOUND_EVENT_NAME,
  buildOutboundRowFilters,
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

describe("outbound link filters", () => {
  it("restricts sessions to those that clicked out to the destination", () => {
    const params: Record<string, unknown> = {};
    const built = buildSessionFilters(
      {
        outbound_domain: { op: "is", value: "github.com" },
        outbound_url: { op: "not_contains", value: "utm_" },
      },
      params,
    );
    assert.equal(built.clauses.length, 0);
    assert.match(
      built.pageRestriction,
      /session_id IN \([\s\S]*event_name = \{flt_outbound_event:String\} AND domainWithoutWWW\(meta\.value\[indexOf\(meta\.key, 'href'\)\]\) = \{flt_outbound_domain:String\}/,
    );
    assert.match(
      built.pageRestriction,
      /session_id NOT IN \([\s\S]*positionCaseInsensitive\(meta\.value\[indexOf\(meta\.key, 'href'\)\], \{flt_outbound_url:String\}\) > 0/,
    );
    assert.equal(params.flt_outbound_domain, "github.com");
    assert.equal(params.flt_outbound_url, "utm_");
    assert.equal(params.flt_outbound_event, OUTBOUND_EVENT_NAME);
  });

  it("restricts sessions by downloaded file and applies it row-level only to the download report", () => {
    const params: Record<string, unknown> = {};
    const built = buildSessionFilters({ download: { op: "contains", value: ".pdf" } }, params);
    assert.match(
      built.pageRestriction,
      /event_name = \{flt_download_event:String\} AND positionCaseInsensitive\(meta\.value\[indexOf\(meta\.key, 'href'\)\], \{flt_download:String\}\) > 0/,
    );
    assert.equal(params.flt_download_event, "File Download");
    const filters = { download: { op: "is" as const, value: "https://x.test/a.pdf" }, outbound_domain: { op: "is" as const, value: "github.com" } };
    assert.match(buildOutboundRowFilters(filters, {}, "download"), /^\s*AND meta\.value\[indexOf\(meta\.key, 'href'\)\] = \{flt_download:String\}$/);
    assert.match(buildOutboundRowFilters(filters, {}, "outbound"), /^\s*AND domainWithoutWWW.*flt_outbound_domain:String\}$/);
  });

  it("builds row predicates on the destination for the outbound report only", () => {
    const params: Record<string, unknown> = {};
    const clauses = buildOutboundRowFilters(
      {
        outbound_domain: { op: "is_not", value: "example.com" },
        browser: { op: "is", value: "Chrome" },
        page: { op: "is", value: "/" },
      },
      params,
    );
    assert.equal(
      clauses.trim(),
      "AND domainWithoutWWW(meta.value[indexOf(meta.key, 'href')]) != {flt_outbound_domain:String}",
    );
    assert.deepEqual(params, { flt_outbound_domain: "example.com" });
    assert.equal(buildOutboundRowFilters({ browser: { op: "is", value: "Chrome" } }, {}), "");
  });
});

describe("channel filter", () => {
  it("carries the columns that regroup old sessions as AI Assistants", () => {
    const built = buildSessionFilters({ channel: { op: "is", value: "AI Assistants" } }, {});
    for (const column of ["channel", "referrer_domain", "utm_source"]) {
      assert.ok(built.columns.includes(column), column);
    }
  });
});
