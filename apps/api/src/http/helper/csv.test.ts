import { test } from "node:test";
import assert from "node:assert/strict";

import { csvCell, safeFilenamePart, toCsv } from "./csv.js";

test("plain cells pass through, empties and non-finite numbers are blank", () => {
  assert.equal(csvCell("Chrome"), "Chrome");
  assert.equal(csvCell(42), "42");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell(Number.NaN), "");
});

test("cells with commas, quotes or newlines are quoted and inner quotes doubled", () => {
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
});

test("formula-looking cells are neutralised for spreadsheets", () => {
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("+1"), "'+1");
  assert.equal(csvCell("-1"), "'-1");
  assert.equal(csvCell("@cmd"), "'@cmd");
  // Quoting still applies after neutralising.
  assert.equal(csvCell("=a,b"), "\"'=a,b\"");
});

test("toCsv writes a header row and CRLF line endings", () => {
  const out = toCsv(["name", "visitors"], [["/", 10], ["/a,b", 2]]);
  assert.equal(out, 'name,visitors\r\n/,10\r\n"/a,b",2\r\n');
});

test("safeFilenamePart keeps only filename-safe characters", () => {
  assert.equal(safeFilenamePart("example.com"), "example.com");
  assert.equal(safeFilenamePart("../../etc/passwd"), "etc-passwd");
  assert.equal(safeFilenamePart('a"b; c'), "a-b-c");
  assert.equal(safeFilenamePart("///"), "export");
});
