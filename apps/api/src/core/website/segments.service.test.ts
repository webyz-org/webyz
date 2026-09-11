import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SEGMENT_FILTERS,
  MAX_SEGMENT_FILTER_VALUE_LENGTH,
  MAX_SEGMENT_NAME_LENGTH,
  normalizeSegmentName,
  validateSegmentFilters,
} from "./segments.service.js";

const rejects = (fn: () => unknown, code: string, messagePart?: string) => {
  assert.throws(fn, (err: unknown) => {
    const e = err as { code?: string; statusCode?: number; message?: string };
    assert.equal(e.code, code);
    if (messagePart) assert.match(e.message ?? "", new RegExp(messagePart));
    return true;
  });
};

test("normalizeSegmentName trims and bounds the name", () => {
  assert.equal(normalizeSegmentName("  Mobile from DE  "), "Mobile from DE");
  assert.equal(normalizeSegmentName("a".repeat(MAX_SEGMENT_NAME_LENGTH)), "a".repeat(MAX_SEGMENT_NAME_LENGTH));

  rejects(() => normalizeSegmentName(""), "BAD_REQUEST", "required");
  rejects(() => normalizeSegmentName("   "), "BAD_REQUEST", "required");
  rejects(() => normalizeSegmentName("a".repeat(MAX_SEGMENT_NAME_LENGTH + 1)), "BAD_REQUEST", "at most");
  rejects(() => normalizeSegmentName(42), "BAD_REQUEST", "string");
  rejects(() => normalizeSegmentName(undefined), "BAD_REQUEST", "string");
});

test("validateSegmentFilters accepts wire-form filters with every operator prefix", () => {
  const filters = {
    browser: "Chrome",
    page: "!~/admin",
    country: "!DE",
    source: "~google",
    utm_campaign: "=!literal",
  };
  assert.deepEqual(validateSegmentFilters(filters), filters);
});

test("validateSegmentFilters accepts the dashboard-level goal key", () => {
  assert.deepEqual(validateSegmentFilters({ goal: "Signup" }), { goal: "Signup" });
});

test("validateSegmentFilters rejects anything that is not a non-empty object", () => {
  rejects(() => validateSegmentFilters(null), "BAD_REQUEST", "object");
  rejects(() => validateSegmentFilters("browser=Chrome"), "BAD_REQUEST", "object");
  rejects(() => validateSegmentFilters(["browser"]), "BAD_REQUEST", "object");
  rejects(() => validateSegmentFilters({}), "BAD_REQUEST", "at least one");
});

test("validateSegmentFilters rejects unknown keys", () => {
  rejects(() => validateSegmentFilters({ hostname: "x" }), "BAD_REQUEST", "Unknown filter key");
  rejects(() => validateSegmentFilters({ browser: "Chrome", __proto__x: "y" }), "BAD_REQUEST", "Unknown filter key");
});

test("validateSegmentFilters rejects values that are not strings or that carry no value", () => {
  rejects(() => validateSegmentFilters({ browser: "" }), "BAD_REQUEST", "non-empty string");
  rejects(() => validateSegmentFilters({ browser: 1 }), "BAD_REQUEST", "non-empty string");
  rejects(() => validateSegmentFilters({ browser: ["Chrome"] }), "BAD_REQUEST", "non-empty string");
  // An operator prefix with nothing after it parses to no condition.
  rejects(() => validateSegmentFilters({ page: "!" }), "BAD_REQUEST", "operator but no value");
  rejects(() => validateSegmentFilters({ page: "!~" }), "BAD_REQUEST", "operator but no value");
  rejects(() => validateSegmentFilters({ page: "~" }), "BAD_REQUEST", "operator but no value");
  rejects(() => validateSegmentFilters({ page: "=" }), "BAD_REQUEST", "operator but no value");
});

test("validateSegmentFilters bounds value length and filter count", () => {
  const max = "a".repeat(MAX_SEGMENT_FILTER_VALUE_LENGTH);
  assert.deepEqual(validateSegmentFilters({ page: max }), { page: max });
  rejects(() => validateSegmentFilters({ page: max + "a" }), "BAD_REQUEST", "at most");

  const tooMany = Object.fromEntries(
    ["browser", "os", "device", "screen", "language", "channel", "source", "country", "region", "city", "page"]
      .slice(0, MAX_SEGMENT_FILTERS + 1)
      .map((key) => [key, "x"]),
  );
  assert.equal(Object.keys(tooMany).length, MAX_SEGMENT_FILTERS + 1);
  rejects(() => validateSegmentFilters(tooMany), "BAD_REQUEST", "at most");
});
