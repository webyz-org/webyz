import { test } from "node:test";
import assert from "node:assert/strict";

import { getPlanDefinition } from "../catalog/index.js";
import { classifyChange, diffEntitlements } from "./plan-change.service.js";
import { pickActiveSites } from "./site-limit.service.js";

test("classification: higher plan is an upgrade, lower is a downgrade, cycle decides ties", () => {
  const m = (sortOrder: number, cycle: "MONTHLY" | "YEARLY") => ({ sortOrder, cycle });
  assert.equal(classifyChange(m(2, "MONTHLY"), m(3, "MONTHLY")), "upgrade");
  assert.equal(classifyChange(m(3, "YEARLY"), m(2, "YEARLY")), "downgrade");
  assert.equal(classifyChange(m(2, "MONTHLY"), m(2, "YEARLY")), "upgrade", "monthly to annual pays more up front");
  assert.equal(classifyChange(m(2, "YEARLY"), m(2, "MONTHLY")), "downgrade", "annual to monthly waits for the year end");
  assert.equal(classifyChange(m(2, "MONTHLY"), m(2, "MONTHLY")), "same");
  // A lower plan on a longer cycle is still a downgrade: plan rank wins.
  assert.equal(classifyChange(m(3, "MONTHLY"), m(2, "YEARLY")), "downgrade");
});

test("entitlement diff lists changed limits and gained or lost features with labels", () => {
  const growth = getPlanDefinition("growth").entitlements;
  const free = getPlanDefinition("free").entitlements;
  const down = diffEntitlements(growth, free);
  assert.deepEqual(
    down.limits.map((l) => [l.key, l.from, l.to]),
    [
      ["sites", 10, 1],
      ["events_per_period", 500_000, 10_000],
      ["retention_days", 730, 90],
      ["team_members", 5, 1],
    ],
  );
  assert.deepEqual(down.featuresLost.map((f) => f.key).sort(), ["api_access", "exports", "funnels", "journeys", "search_console"].sort());
  assert.deepEqual(down.featuresGained, []);
  const up = diffEntitlements(free, growth);
  assert.deepEqual(up.featuresLost, []);
  assert.equal(up.featuresGained.length, 5);
  assert.ok(up.featuresGained.every((f) => typeof f.label === "string" && f.label.length > 0));
  assert.deepEqual(diffEntitlements(growth, growth), { limits: [], featuresGained: [], featuresLost: [] });
});

test("site picking keeps the customer's active choice first, then the oldest, never by traffic", () => {
  const d = (s: string) => new Date(s);
  const sites = [
    { id: "a", isActive: true, createdAt: d("2026-01-01") },
    { id: "b", isActive: false, createdAt: d("2026-02-01") }, // customer made this inactive earlier
    { id: "c", isActive: true, createdAt: d("2026-03-01") },
    { id: "d", isActive: true, createdAt: d("2026-04-01") },
  ];
  const one = pickActiveSites(sites, 1);
  assert.deepEqual([...one.keep], ["a"]);
  assert.deepEqual(one.toRestrict.map((s) => s.id), ["c", "d"]);
  assert.deepEqual(one.toActivate, []);

  const three = pickActiveSites(sites, 3);
  assert.deepEqual([...three.keep].sort(), ["a", "c", "d"], "active sites are preferred over the inactive older one");
  assert.deepEqual(three.toRestrict, []);
  assert.deepEqual(three.toActivate, []);

  const all = pickActiveSites(sites, 10);
  assert.deepEqual(all.toActivate.map((s) => s.id), ["b"], "an upgrade reactivates what fits");

  const none = pickActiveSites(sites, 0);
  assert.equal(none.toRestrict.length, 3);
});
