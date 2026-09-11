import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeRecipients } from "./recipients.js";

test("recipients are trimmed, lowercased and deduplicated", () => {
  assert.deepEqual(normalizeRecipients([" A@Example.com ", "a@example.com", "b@example.org"]), [
    "a@example.com",
    "b@example.org",
  ]);
});

test("recipients: empty, invalid and oversized lists are rejected", () => {
  assert.throws(() => normalizeRecipients([]), /at least one/);
  assert.throws(() => normalizeRecipients(["", "  "]), /at least one/);
  assert.throws(() => normalizeRecipients(["not-an-email"]), /not a valid/);
  assert.throws(() => normalizeRecipients(["a@b"]), /not a valid/);
  assert.throws(() => normalizeRecipients(Array.from({ length: 11 }, (_, i) => `u${i}@example.com`)), /At most 10/);
  assert.throws(() => normalizeRecipients("a@example.com"), /must be a list/);
});
