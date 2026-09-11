import { test } from "node:test";
import assert from "node:assert/strict";

import { applyCustomEvent } from "./session.service.js";
import type { SessionData } from "./types.js";

const base: SessionData = {
  sessionId: "s", websiteId: "w", userId: "u",
  startTime: 1_000, endTime: 1_000, durationSeconds: 0,
  entryPage: "/a", exitPage: "/a", pageViews: 1, events: 1, engagedSeconds: 0, scrollDepth: 0,
  hostname: "example.com", browserFamily: "Chrome", browserVersion: "1", osFamily: "Android", osVersion: "14",
  deviceType: "mobile", deviceBrand: "", screen: "360x800", language: "ml", country: "IN",
  subdivision1: "", subdivision2: "", city: "", channel: "Direct", referrerDomain: "",
  utmSource: "", utmMedium: "", utmCampaign: "", utmContent: "", utmTerm: "",
};

test("a custom event ends the bounce and extends the visit, as in Plausible and Umami", () => {
  const row = applyCustomEvent(base, 1_040);
  assert.equal(row.events, 2, "events = 1 is the bounce test, so this visit is no longer a bounce");
  assert.equal(row.pageViews, 1, "still a single-page visit for views per visit");
  assert.equal(row.endTime, 1_040);
  assert.equal(row.durationSeconds, 40);
});

test("an event that arrives out of order never shortens the visit", () => {
  const later = { ...base, endTime: 1_200, durationSeconds: 200 };
  const row = applyCustomEvent(later, 1_100);
  assert.equal(row.endTime, 1_200);
  assert.equal(row.durationSeconds, 200);
  assert.equal(row.events, 2);
});

test("every other column is carried forward", () => {
  const row = applyCustomEvent(base, 1_005);
  for (const key of Object.keys(base) as (keyof SessionData)[]) {
    if (["endTime", "durationSeconds", "events"].includes(key)) continue;
    assert.deepEqual(row[key], base[key], key);
  }
});
