import { test } from "node:test";
import assert from "node:assert/strict";
import { Ajv } from "ajv";

import { trackingSchema } from "./tracking.schema.js";

// Same options as the tracker route's validator.
const validate = new Ajv({ coerceTypes: true, removeAdditional: false, allErrors: false }).compile(trackingSchema);

const pageview = () => ({ t: "pageview", sid: "site-1", url: "https://example.com/", ts: 1_700_000_000 });

test("a normal pageview validates and keeps custom properties", () => {
  const payload = { ...pageview(), plan: "growth", seats: 3, trial: true };
  assert.equal(validate(payload), true, JSON.stringify(validate.errors));
  assert.equal((payload as Record<string, unknown>).plan, "growth");
});

test("the pixel's query strings are coerced", () => {
  const query: Record<string, unknown> = { t: "event", sid: "site-1", name: "Signup", ts: "1700000000", new_session: "1" };
  assert.equal(validate(query), true, JSON.stringify(validate.errors));
  assert.equal(query.ts, 1_700_000_000);
  assert.equal(query.new_session, 1);
});

test("old client identity fields are accepted", () => {
  assert.equal(validate({ ...pageview(), vid: "abc", ssid: "def", new_visitor: 1 }), true);
});

test("malformed payloads are rejected", () => {
  assert.equal(validate({ sid: "site-1" }), false, "missing type");
  assert.equal(validate({ t: "pageview" }), false, "missing site id");
  assert.equal(validate({ t: "purchase", sid: "site-1" }), false, "unknown type");
  assert.equal(validate({ ...pageview(), title: "x".repeat(501) }), false, "title too long");
  assert.equal(validate({ ...pageview(), url: "x".repeat(2049) }), false, "url too long");
  assert.equal(validate({ ...pageview(), ts: -5 }), false, "negative timestamp");
  assert.equal(validate({ ...pageview(), props: { nested: true } }), false, "object-valued custom prop");
  assert.equal(validate({ ...pageview(), big: "y".repeat(501) }), false, "custom prop too long");
  assert.equal(validate([]), false, "not an object");
});
