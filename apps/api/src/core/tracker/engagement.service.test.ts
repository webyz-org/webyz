import { test } from "node:test";
import assert from "node:assert/strict";

import { applyEngagement } from "./engagement.service.js";
import type { SessionData } from "./types.js";

const base: SessionData = {
  sessionId: "s",
  websiteId: "w",
  userId: "u",
  startTime: 1_000,
  endTime: 1_000,
  durationSeconds: 0,
  entryPage: "/a",
  exitPage: "/a",
  pageViews: 1,
  events: 1,
  engagedSeconds: 0,
  scrollDepth: 0,
  hostname: "example.com",
  browserFamily: "Chrome",
  browserVersion: "1",
  osFamily: "Android",
  osVersion: "14",
  deviceType: "mobile",
  deviceBrand: "Samsung",
  screen: "360x800",
  language: "ml",
  country: "IN",
  subdivision1: "",
  subdivision2: "",
  city: "Kochi",
  channel: "Direct",
  referrerDomain: "",
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
  utmContent: "",
  utmTerm: "",
};

test("a single-page visit gains the time the page was visible", () => {
  const row = applyEngagement(base, { ms: 90_400, scrollDepth: 65 }, 1_095);
  assert.equal(row.durationSeconds, 95);
  assert.equal(row.endTime, 1_095);
  assert.equal(row.engagedSeconds, 90);
  assert.equal(row.scrollDepth, 65);
  // A bounce is still a bounce: one pageview.
  assert.equal(row.pageViews, 1);
});

test("reports accumulate time and keep the deepest scroll", () => {
  const once = applyEngagement(base, { ms: 10_000, scrollDepth: 40 }, 1_010);
  const twice = applyEngagement(once, { ms: 5_000, scrollDepth: 20 }, 1_030);
  assert.equal(twice.engagedSeconds, 15);
  assert.equal(twice.scrollDepth, 40);
  assert.equal(twice.durationSeconds, 30);
});

test("a late report never moves the end of the visit backwards", () => {
  const later = { ...base, endTime: 1_200, durationSeconds: 200 };
  const row = applyEngagement(later, { ms: 1_000, scrollDepth: 10 }, 1_150);
  assert.equal(row.endTime, 1_200);
  assert.equal(row.durationSeconds, 200);
});

test("every other column is carried forward", () => {
  const row = applyEngagement(base, { ms: 3_000, scrollDepth: 50 }, 1_003);
  for (const key of Object.keys(base) as (keyof SessionData)[]) {
    if (["endTime", "durationSeconds", "engagedSeconds", "scrollDepth"].includes(key)) continue;
    assert.deepEqual(row[key], base[key], key);
  }
});
