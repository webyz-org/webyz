import assert from "node:assert/strict";
import { test } from "node:test";

import { parseUrlData } from "./url-parser.js";

test("a path is stored as visited, /undefined included", () => {
  assert.equal(parseUrlData("https://example.com/undefined", "", "example.com").urlPath, "/undefined");
  assert.equal(parseUrlData("https://example.com/blog/undefined", "", "example.com").urlPath, "/blog/undefined");
  assert.equal(parseUrlData("https://example.com/", "", "example.com").urlPath, "/");
});

test("query and fragment are split from the path", () => {
  const parsed = parseUrlData("https://example.com/pricing?plan=growth#faq", "", "example.com");
  assert.equal(parsed.urlPath, "/pricing#faq");
  assert.equal(parsed.urlQuery, "plan=growth");
});
