import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GA4_REPORTS,
  channelLabel,
  ga4Date,
  initcap,
  languageTag,
  linkHost,
  mapReportRows,
  sourceLabel,
  type ImportedRow,
} from "./ga4-reports.js";

const spec = (key: string) => {
  const found = GA4_REPORTS.find((r) => r.key === key);
  assert.ok(found, key);
  return found;
};

/** Map rows the way the engine does: requested dimensions in order after date. */
const map = (key: string, requested: string[], rows: Array<[string[], string[]]>): ImportedRow[] => [
  ...mapReportRows(spec(key), requested, rows.map(([dimensions, metrics]) => ({ dimensions, metrics }))).values(),
];

// users, sessions, views, engagedSessions, averageSessionDuration
const S = (users: number, sessions: number, views: number, engaged: number, avg: number) =>
  [users, sessions, views, engaged, avg].map(String);

describe("GA4 labels match what Webyz renders", () => {
  it("maps source and medium to Webyz's source label", () => {
    assert.equal(sourceLabel("(direct)", "(none)"), "(direct)");
    assert.equal(sourceLabel("google", "organic"), "google.com");
    assert.equal(sourceLabel("google", "cpc"), "google.com");
    assert.equal(sourceLabel("www.example.com", "referral"), "example.com");
    assert.equal(sourceLabel("newsletter", "email"), "newsletter");
  });

  it("classifies channels with Webyz's own rules, AI assistants included", () => {
    assert.equal(channelLabel("(direct)", "(none)"), "Direct");
    assert.equal(channelLabel("google", "organic"), "Organic Search");
    assert.equal(channelLabel("google", "cpc"), "Paid Search");
    assert.equal(channelLabel("chatgpt.com", "referral"), "AI Assistants");
    assert.equal(channelLabel("lm.facebook.com", "referral"), "Organic Social");
    assert.equal(channelLabel("newsletter", "email"), "Email");
  });

  it("formats devices, languages, dates and link hosts", () => {
    assert.equal(initcap("smart tv"), "Smart Tv");
    assert.equal(languageTag("en-us"), "en-US");
    assert.equal(ga4Date("20240131"), "2024-01-31");
    assert.equal(ga4Date("(other)"), null);
    assert.equal(linkHost("https://www.GitHub.com/x"), "github.com");
  });
});

describe("mapReportRows: one row per family combination", () => {
  it("keeps a session's channel, source and UTM fields together", () => {
    const rows = map("sources", ["sessionSource", "sessionMedium", "sessionCampaignName"], [
      [["20240101", "newsletter", "email", "spring"], S(5, 6, 12, 4, 30)],
      [["20240101", "google", "organic", "(organic)"], S(10, 12, 30, 6, 60)],
    ]);
    const email = rows.find((r) => r.utm_campaign === "spring");
    assert.deepEqual(
      [email?.channel, email?.source, email?.utm_source, email?.utm_medium, email?.visits, email?.bounces, email?.visit_duration],
      ["Email", "newsletter", "newsletter", "email", 6, 2, 180],
    );
    const google = rows.find((r) => r.source === "google.com");
    assert.equal(google?.channel, "Organic Search");
    assert.equal(google?.utm_source, "", "organic traffic is not UTM-tagged");
    assert.equal(google?.utm_campaign, "", "GA4's (organic) campaign is a placeholder");
  });

  it("sums GA4 rows that land on the same family combination", () => {
    const rows = map("browsers", ["browser", "browserVersion"], [
      [["20240101", "Edge", "120.0.2210.91"], S(1, 1, 1, 1, 0)],
      [["20240101", "Edge", "120.0.2210.77"], S(2, 2, 2, 2, 0)],
    ]);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].browser, rows[0].browser_version, rows[0].visitors], ["Microsoft Edge", "Microsoft Edge 120.0", 3]);
  });

  it("drops GA4's placeholder values instead of inventing a label", () => {
    const rows = map("locations", ["countryId", "region", "city"], [
      [["20240101", "(not set)", "", ""], S(1, 1, 1, 1, 0)],
      [["20240101", "de", "Hesse", "(not set)"], S(2, 2, 2, 2, 0)],
    ]);
    assert.deepEqual(rows.map((r) => [r.country, r.region, r.city]), [["DE", "Hesse", ""]]);
  });

  it("imported page rows add views and visits but no bounces or seconds", () => {
    const [row] = map("pages", ["pagePath", "hostName"], [[["20240101", "/pricing", "www.example.com"], S(4, 5, 9, 1, 60)]]);
    assert.deepEqual([row.page, row.hostname, row.visits, row.pageviews, row.bounces, row.visit_duration], ["/pricing", "example.com", 5, 9, 0, 0]);
  });

  it("stores GA4 outbound clicks and downloads as the tracker's own events", () => {
    const [click] = map("outbound_links", ["linkUrl"], [[["20240101", "https://www.github.com/x#readme"], ["2", "3"]]]);
    assert.deepEqual([click.family, click.event, click.outbound_url, click.outbound_domain, click.events], [
      "events",
      "Outbound Link: Click",
      "https://www.github.com/x",
      "github.com",
      3,
    ]);
    const [download] = map("downloads", ["linkUrl"], [[["20240101", "https://example.com/a.pdf"], ["1", "1"]]]);
    assert.deepEqual([download.event, download.download], ["File Download", "https://example.com/a.pdf"]);
  });

  it("keeps real custom events and skips GA4's own plumbing", () => {
    const rows = map("events", ["eventName"], [
      [["20240101", "page_view"], ["50", "90"]],
      [["20240101", "sign_up"], ["3", "4"]],
    ]);
    assert.deepEqual(rows.map((r) => [r.event, r.visitors, r.events]), [["sign_up", 3, 4]]);
  });
});
