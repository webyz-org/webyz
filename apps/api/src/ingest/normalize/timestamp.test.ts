import { test } from "node:test";
import assert from "node:assert/strict";

import { eventTimestamp } from "./timestamp.js";

const received = new Date("2026-09-09T08:33:39.000Z");

test("the event time is when the server received it, whatever the client claims", () => {
  assert.equal(eventTimestamp(undefined, received).getTime(), received.getTime());
  // A correct client clock: still the server's time, so ordering is the server's.
  assert.equal(eventTimestamp(Math.floor(received.getTime() / 1000), received).getTime(), received.getTime());
  // Milliseconds sent where seconds were expected (2040 on the old code).
  assert.equal(eventTimestamp(received.getTime(), received).getTime(), received.getTime());
  // A claim years in the past, which would land in a closed billing period.
  assert.equal(eventTimestamp(1_500_000_000, received).getTime(), received.getTime());
  // A claim in the future.
  assert.equal(eventTimestamp(4_000_000_000, received).getTime(), received.getTime());
});
