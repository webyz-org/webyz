import { test } from "node:test";
import assert from "node:assert/strict";

import { TrustProxyError, parseTrustProxy } from "./trust-proxy.js";

test("unset: false in development, refused in production", () => {
  assert.equal(parseTrustProxy(undefined, false), false);
  assert.equal(parseTrustProxy("", false), false);
  assert.throws(() => parseTrustProxy(undefined, true), TrustProxyError);
  assert.throws(() => parseTrustProxy("  ", true), TrustProxyError);
});

test("booleans", () => {
  assert.equal(parseTrustProxy("false", true), false);
  assert.equal(parseTrustProxy("true", true), true);
});

test("hop counts are numbers and must be at least one", () => {
  assert.equal(parseTrustProxy("1", true), 1);
  assert.equal(parseTrustProxy(" 2 ", true), 2);
  assert.throws(() => parseTrustProxy("0", true), TrustProxyError);
});

test("addresses, CIDRs and named ranges pass through as a comma list", () => {
  assert.equal(parseTrustProxy("loopback", true), "loopback");
  assert.equal(parseTrustProxy("10.0.0.0/8, 172.16.0.0/12", true), "10.0.0.0/8,172.16.0.0/12");
  assert.equal(parseTrustProxy("::1,127.0.0.1", true), "::1,127.0.0.1");
});

test("anything else is rejected with the offending entry named", () => {
  assert.throws(() => parseTrustProxy("yes", true), /unrecognised entries: yes/);
  assert.throws(() => parseTrossProxySafe("10.0.0.0/8,nginx"), /nginx/);
});

const parseTrossProxySafe = (v: string) => parseTrustProxy(v, true);
