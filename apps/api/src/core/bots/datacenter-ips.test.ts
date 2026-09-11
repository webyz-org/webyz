import { test } from "node:test";
import assert from "node:assert/strict";

import { decide, parseIPv4, parseIPv6, parseRangeList, rangeSetHas } from "./datacenter-ips.js";

const list = `
# cloud ranges, mixed families, deliberately unsorted
203.0.113.0/24
198.51.100.0/25
198.51.100.128/25
192.0.2.7
2001:db8:abcd::/48
2001:db8::1
not an address
10.0.0.0/33
1.2.3.4/x
`;

test("parses CIDRs and single addresses of both families, ignoring bad lines", () => {
  const set = parseRangeList(list);
  // 198.51.100.0/25 and /25 touch, so they merge into one range.
  assert.equal(set.v4Start.length, 3);
  assert.equal(set.v6Start.length, 2);
  assert.equal(set.size, 5);
});

test("addresses inside a range match, neighbours do not", () => {
  const set = parseRangeList(list);
  assert.equal(rangeSetHas(set, "203.0.113.0"), true);
  assert.equal(rangeSetHas(set, "203.0.113.255"), true);
  assert.equal(rangeSetHas(set, "203.0.114.0"), false);
  assert.equal(rangeSetHas(set, "203.0.112.255"), false);
  assert.equal(rangeSetHas(set, "198.51.100.200"), true);
  assert.equal(rangeSetHas(set, "192.0.2.7"), true);
  assert.equal(rangeSetHas(set, "192.0.2.8"), false);
  assert.equal(rangeSetHas(set, "8.8.8.8"), false);
});

test("IPv6 ranges, single addresses and v4-mapped clients", () => {
  const set = parseRangeList(list);
  assert.equal(rangeSetHas(set, "2001:db8:abcd:1234::1"), true);
  assert.equal(rangeSetHas(set, "2001:db8:abce::1"), false);
  assert.equal(rangeSetHas(set, "2001:db8::1"), true);
  assert.equal(rangeSetHas(set, "2001:db8::2"), false);
  // A dual-stack socket reports an IPv4 client this way.
  assert.equal(rangeSetHas(set, "::ffff:203.0.113.9"), true);
  assert.equal(rangeSetHas(set, "::ffff:9.9.9.9"), false);
});

test("a host bit set in the CIDR is masked off, as list publishers sometimes do", () => {
  const set = parseRangeList("203.0.113.77/24");
  assert.equal(rangeSetHas(set, "203.0.113.1"), true);
});

test("garbage and empty input match nothing", () => {
  const set = parseRangeList(list);
  assert.equal(rangeSetHas(set, ""), false);
  assert.equal(rangeSetHas(set, "banana"), false);
  assert.equal(rangeSetHas(set, "999.1.1.1"), false);
  assert.equal(rangeSetHas(parseRangeList(""), "203.0.113.1"), false);
});

test("address parsers", () => {
  assert.equal(parseIPv4("1.2.3.4"), 16909060);
  assert.equal(parseIPv4("1.2.3"), null);
  assert.equal(parseIPv4("1.2.3.256"), null);
  assert.equal(parseIPv6("::1"), 1n);
  assert.equal(parseIPv6("::ffff:1.2.3.4"), (0xffffn << 32n) | 16909060n);
  assert.equal(parseIPv6("1::2::3"), null);
  assert.equal(parseIPv6("1:2:3:4:5:6:7"), null);
});

test("a provider's JSON range file is reduced to its CIDRs", async () => {
  const { toLines } = await import("./list-updater.service.js");
  const json = `{"prefixes":[{"ipv4Prefix":"34.1.208.0/20","service":"Google Cloud"},{"ipv6Prefix":"2600:1900:4000::/44"}]}`;
  assert.equal(toLines(json), "34.1.208.0/20\n2600:1900:4000::/44");
  // Plain text is untouched.
  assert.equal(toLines("1.2.3.0/24\n"), "1.2.3.0/24\n");
  const set = parseRangeList(toLines(json));
  assert.equal(rangeSetHas(set, "34.1.208.9"), true);
  assert.equal(rangeSetHas(set, "2600:1900:4000::9"), true);
});

test("a CSV list such as Apple's relay egress file parses by its first column", () => {
  const set = parseRangeList("172.224.226.0/27,GB,GB-EN,London,\n2a02:26f7:c9c8:4000::/54,IN,IN-KL,Kochi,\n");
  assert.equal(set.size, 2);
  assert.equal(rangeSetHas(set, "172.224.226.5"), true);
  assert.equal(rangeSetHas(set, "2a02:26f7:c9c8:4000::9"), true);
});

test("an allowed range wins over the deny list", () => {
  const deny = parseRangeList("172.224.0.0/12\n203.0.113.0/24");
  const allow = parseRangeList("172.224.226.0/27,GB,GB-EN,London,");
  assert.equal(decide({ deny, allow }, "172.224.226.5"), false);
  assert.equal(decide({ deny, allow }, "172.224.1.1"), true);
  assert.equal(decide({ deny, allow }, "203.0.113.9"), true);
  assert.equal(decide({ deny, allow: null }, "172.224.226.5"), true);
});
