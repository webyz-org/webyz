import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchPaddleIps, ipMatchesCidrs, paddleIpsUrl } from "./paddle-ips.js";

test("addresses are matched against /32 and wider prefixes, IPv4-mapped forms included", () => {
  const cidrs = ["34.237.3.244/32", "10.0.0.0/8"];
  assert.equal(ipMatchesCidrs("34.237.3.244", cidrs), true);
  assert.equal(ipMatchesCidrs("::ffff:34.237.3.244", cidrs), true);
  assert.equal(ipMatchesCidrs("34.237.3.245", cidrs), false);
  assert.equal(ipMatchesCidrs("10.200.1.1", cidrs), true);
  assert.equal(ipMatchesCidrs("11.0.0.1", cidrs), false);
  assert.equal(ipMatchesCidrs("not an address", cidrs), false);
  assert.equal(ipMatchesCidrs("2001:db8::1", cidrs), false, "IPv6 never matches an IPv4 list");
  assert.equal(ipMatchesCidrs("1.2.3.4", []), false);
  assert.equal(ipMatchesCidrs("1.2.3.4", ["garbage", "1.2.3.4"]), true, "a bare address is a /32; junk entries are skipped");
});

test("each environment has its own list", () => {
  assert.equal(paddleIpsUrl("production"), "https://api.paddle.com/ips");
  assert.equal(paddleIpsUrl("sandbox"), "https://sandbox-api.paddle.com/ips");
});

test("the list is read from data.ipv4_cidrs and anything else is refused", async () => {
  const ok = (body: unknown) => (async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;
  assert.deepEqual(await fetchPaddleIps("production", ok({ data: { ipv4_cidrs: ["1.1.1.1/32"] } })), ["1.1.1.1/32"]);
  await assert.rejects(() => fetchPaddleIps("production", ok({ data: { ipv4_cidrs: [] } })), /without an ipv4_cidrs list/);
  await assert.rejects(() => fetchPaddleIps("production", ok({ data: {} })), /without an ipv4_cidrs list/);
  const down = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
  await assert.rejects(() => fetchPaddleIps("production", down), /answered 503/);
});
