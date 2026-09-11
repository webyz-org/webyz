import { test } from "node:test";
import assert from "node:assert/strict";

import { domainListed, parseDomainList } from "./referrer-spam.js";
import { clusterKey, isScriptedCluster, type ClusterRow } from "./clusters.js";

test("referrer spam: listed domains and their subdomains match, others do not", () => {
  const list = parseDomainList("# matomo list\nsemalt.com\nwww.buttons-for-website.com\n\nnot-a-domain\n");
  assert.equal(list.size, 2);
  assert.equal(domainListed(list, "semalt.com"), true);
  assert.equal(domainListed(list, "www.semalt.com"), true);
  assert.equal(domainListed(list, "click.semalt.com"), true);
  assert.equal(domainListed(list, "buttons-for-website.com"), true);
  assert.equal(domainListed(list, "notsemalt.com"), false);
  assert.equal(domainListed(list, "google.com"), false);
  assert.equal(domainListed(list, ""), false);
});

const cluster = (over: Partial<ClusterRow>): ClusterRow => ({
  website_id: "w",
  screen: "375x812",
  browser_family: "Chrome",
  language: "en-US",
  visits: 400,
  visitors: 380,
  bounces: 399,
  engaged: 0,
  ...over,
});

test("a large all-bounce group with no engagement is scripted", () => {
  assert.equal(isScriptedCluster(cluster({})), true);
});

test("one engaged session, a human bounce rate, or a small group is not", () => {
  assert.equal(isScriptedCluster(cluster({ engaged: 1 })), false);
  assert.equal(isScriptedCluster(cluster({ bounces: 300 })), false);
  assert.equal(isScriptedCluster(cluster({ visits: 49, visitors: 49, bounces: 49 })), false);
  // Many visits from a handful of visitors is one person reloading, not a farm.
  assert.equal(isScriptedCluster(cluster({ visitors: 5 })), false);
});

test("the flag key is built from the same fields the query groups on", () => {
  assert.equal(clusterKey("375x812", "Chrome", "en-US"), "375x812|Chrome|en-US");
});
