import { test } from "node:test";
import assert from "node:assert/strict";

import { shouldReprocess } from "./webhook.service.js";

test("an event never seen before is processed", () => {
  assert.equal(shouldReprocess(null), true);
});

test("a finished or ignored event is never processed twice", () => {
  assert.equal(shouldReprocess({ status: "PROCESSED" }), false);
  assert.equal(shouldReprocess({ status: "IGNORED" }), false);
});

test("a crashed or failed attempt is retried on redelivery", () => {
  assert.equal(shouldReprocess({ status: "RECEIVED" }), true);
  assert.equal(shouldReprocess({ status: "FAILED" }), true);
});
