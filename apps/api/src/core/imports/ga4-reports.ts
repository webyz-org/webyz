import { classifyChannel } from "../../ingest/helpers/channel.js";
import { shortVersion } from "../../utils/version.js";
import type { ImportColumn, ImportFamily } from "./imported-plan.js";

/**
 * What the GA4 import asks Google for, and how each answer becomes rows of
 * `imported_stats`: one row per day and combination of a report family's
 * attributes, labelled exactly as the matching Webyz breakdown renders them.
 * The reports follow the families Plausible's own GA4 importer uses (its
 * `Plausible.Google.GA4.ReportRequest`), so a filter can apply to imported
 * rows of the same family (core/imports/imported-plan.ts).
 *
 * Deliberately not imported (the import screen lists these): new vs
 * returning, cohorts and first-user attribution, which need the same person
 * recognised across days and so contradict the daily-rotating visitor id;
 * age, gender and interests, which are Google's ad profiling; Google Ads
 * dimensions, which exist only inside Google's ad system. GA4 has no exit
 * page dimension, so exit pages start with the first tracked day.
 */

export type ImportedMetrics = {
  visitors: number;
  visits: number;
  pageviews: number;
  bounces: number;
  visit_duration: number;
  events: number;
  scroll_depth?: number;
  scroll_depth_visits?: number;
  time_on_page?: number;
  time_on_page_visits?: number;
};

/** One `imported_stats` row before it is tagged with site and import. */
export type ImportedRow = { date: string; family: ImportFamily } & Partial<Record<ImportColumn, string>> & ImportedMetrics;

export type Attributes = Partial<Record<ImportColumn, string>>;

/**
 * Session-shaped metrics, Plausible's way: users, sessions, views, bounces as
 * sessions that were not engaged, and total seconds (average x sessions) so
 * merged averages weight by visits. GA4's bounce ("not engaged": under 10 s,
 * one page, no key event) is a close cousin of Webyz's (one pageview and no
 * custom event), not the same definition.
 */
const SESSION_METRICS = ["totalUsers", "sessions", "screenPageViews", "engagedSessions", "averageSessionDuration"] as const;

/** Event-shaped metrics: how many fired, and by how many people. */
const EVENT_METRICS = ["totalUsers", "eventCount"] as const;

const num = (value: string | undefined) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Placeholder values GA4 uses for "no value"; never a real label. */
const NOT_SET = new Set(["", "(not set)", "(none)", "(other)", "(data not available)"]);
const isSet = (value: string | undefined): value is string =>
  value !== undefined && !NOT_SET.has(value.trim());

/** ClickHouse initcap(lower(x)), which renders the device breakdown. */
export const initcap = (value: string) =>
  value.toLowerCase().replace(/(^|[^a-z0-9])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());

/** GA4 browser names that differ from what the Webyz tracker records. */
const BROWSER_NAMES: Record<string, string> = {
  Edge: "Microsoft Edge",
  "Safari (in-app)": "Safari",
};

/** GA4 operating system names that differ from Webyz's. */
const OS_NAMES: Record<string, string> = {
  Macintosh: "macOS",
};

const browserName = (value: string) => BROWSER_NAMES[value] ?? value;
const osName = (value: string) => OS_NAMES[value] ?? value;

/** "en-us" -> "en-US", the browser locale shape the tracker sends. */
export const languageTag = (code: string) => {
  const [lang, region, ...rest] = code.split("-");
  if (!lang) return "";
  return [lang.toLowerCase(), ...(region ? [region.length === 2 ? region.toUpperCase() : region] : []), ...rest].join("-");
};

/**
 * Search engines GA4 names bare ("google / organic", "google / cpc") where
 * Webyz records the referrer host ("google.com"), mapped so a search engine
 * lands on one row whether the click was organic or paid.
 */
const SEARCH_ENGINE_HOSTS: Record<string, string> = {
  google: "google.com",
  bing: "bing.com",
  duckduckgo: "duckduckgo.com",
  yahoo: "search.yahoo.com",
  ecosia: "ecosia.org",
  baidu: "baidu.com",
  yandex: "yandex.ru",
};

/** Webyz's source label for a GA4 source / medium pair. */
export const sourceLabel = (source: string, medium: string): string => {
  const s = source.trim().toLowerCase();
  if (s === "(direct)" || (!isSet(source) && !isSet(medium))) return "(direct)";
  return SEARCH_ENGINE_HOSTS[s] ?? s.replace(/^www\./, "");
};

/**
 * Webyz's channel for a GA4 source / medium pair, from Webyz's own classifier
 * rather than GA4's channel group, so imported and tracked visits are grouped
 * by one set of rules (AI assistants included).
 */
export const channelLabel = (source: string, medium: string): string => {
  const m = medium.trim().toLowerCase();
  const label = sourceLabel(source, medium);
  if (label === "(direct)") return "Direct";
  if (m === "referral" || m === "organic") return classifyChannel({ referrerDomain: label });
  return classifyChannel({ utmMedium: isSet(medium) ? m : "", utmSource: label });
};

/** An outbound or download URL as the tracker stores it: no fragment. */
const linkUrl = (value: string) => value.trim().replace(/#.*$/, "");

/** The destination host without www., as the outbound report groups it. */
export const linkHost = (value: string) => {
  const raw = value.trim().toLowerCase();
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^www\./, "");
  }
};

/**
 * GA4 events that are measurement plumbing or feed another report here, so
 * they are not imported as custom events: page views, sessions and engagement
 * are the visit totals; scroll is scroll depth; click, file_download and
 * view_search_results feed outbound links, downloads and site search.
 */
const GA4_INTERNAL_EVENTS = new Set([
  "page_view",
  "session_start",
  "first_visit",
  "user_engagement",
  "scroll",
  "click",
  "file_download",
  "view_search_results",
]);

const sessionMetrics = (m: string[]): ImportedMetrics => {
  const sessions = Math.round(num(m[1]));
  return {
    visitors: Math.round(num(m[0])),
    visits: sessions,
    pageviews: Math.round(num(m[2])),
    bounces: Math.max(0, sessions - Math.round(num(m[3]))),
    visit_duration: Math.round(num(m[4]) * sessions),
    events: 0,
  };
};

const eventMetrics = (m: string[]): ImportedMetrics => ({
  visitors: Math.round(num(m[0])),
  visits: 0,
  pageviews: 0,
  bounces: 0,
  visit_duration: 0,
  events: Math.round(num(m[1])),
});

/** A GA4 value as an attribute: '' for GA4's placeholders. */
const val = (value: string | undefined) => (isSet(value) ? value.trim() : "");

/** GA4 marks untagged traffic with parenthesised campaign names. */
const campaignValue = (value: string | undefined) => {
  const v = val(value);
  return /^\(.*\)$/.test(v) ? "" : v;
};

export type ReportSpec = {
  /** Stable key. */
  key: string;
  /** Shown to the owner when the property cannot serve this report. */
  label: string;
  family: ImportFamily;
  /** Required dimensions after `date`, which every report requests first. */
  dimensions: string[];
  /** Requested when the property offers them; the rows lose those attributes otherwise. */
  optionalDimensions?: string[];
  metrics: readonly string[];
  filters?: Array<{ fieldName: string; value: string }>;
  /** The row's attributes by GA4 dimension name, or null to drop the row. */
  attributes: (dims: Record<string, string>) => Attributes | null;
  toMetrics: (metrics: string[]) => ImportedMetrics;
};

export const GA4_REPORTS: ReportSpec[] = [
  {
    key: "totals",
    label: "Visitors, visits, pageviews, bounce rate and duration",
    family: "visitors",
    dimensions: [],
    metrics: SESSION_METRICS,
    attributes: () => ({}),
    toMetrics: sessionMetrics,
  },
  {
    key: "sources",
    label: "Channels, sources and UTM",
    family: "sources",
    dimensions: ["sessionSource", "sessionMedium"],
    optionalDimensions: ["sessionCampaignName", "sessionManualAdContent", "sessionManualTerm"],
    metrics: SESSION_METRICS,
    attributes: (d) => {
      const source = d.sessionSource ?? "";
      const medium = d.sessionMedium ?? "";
      const m = val(medium).toLowerCase();
      // Tagged traffic: anything but GA4's own organic, referral and direct mediums.
      const tagged = m !== "" && !["organic", "referral", "(none)", "none"].includes(m);
      return {
        channel: channelLabel(source, medium),
        source: sourceLabel(source, medium),
        utm_source: tagged ? val(source) : "",
        utm_medium: tagged ? val(medium) : "",
        utm_campaign: campaignValue(d.sessionCampaignName),
        utm_content: campaignValue(d.sessionManualAdContent),
        utm_term: campaignValue(d.sessionManualTerm),
      };
    },
    toMetrics: sessionMetrics,
  },
  {
    key: "pages",
    label: "Pages",
    family: "pages",
    dimensions: ["pagePath"],
    optionalDimensions: ["hostName"],
    metrics: SESSION_METRICS,
    attributes: (d) =>
      isSet(d.pagePath) ? { page: d.pagePath, hostname: val(d.hostName).toLowerCase().replace(/^www\./, "") } : null,
    // Plausible's convention: an imported page row adds visitors, visits and
    // views, never bounces or visit seconds (RATE_NEUTRAL_FAMILIES).
    toMetrics: (m) => ({ ...sessionMetrics(m), bounces: 0, visit_duration: 0 }),
  },
  {
    key: "titles",
    label: "Page titles",
    family: "titles",
    dimensions: ["pageTitle"],
    metrics: SESSION_METRICS,
    attributes: (d) => (isSet(d.pageTitle) ? { title: d.pageTitle } : null),
    toMetrics: sessionMetrics,
  },
  {
    key: "entry_pages",
    label: "Entry pages",
    family: "entry_pages",
    dimensions: ["landingPage"],
    metrics: SESSION_METRICS,
    attributes: (d) => (isSet(d.landingPage) ? { entry_page: d.landingPage } : null),
    toMetrics: sessionMetrics,
  },
  {
    key: "locations",
    label: "Countries, regions and cities",
    family: "locations",
    dimensions: ["countryId"],
    optionalDimensions: ["region", "city"],
    metrics: SESSION_METRICS,
    attributes: (d) =>
      isSet(d.countryId) && /^[A-Za-z]{2}$/.test(d.countryId)
        ? { country: d.countryId.toUpperCase(), region: val(d.region), city: val(d.city) }
        : null,
    toMetrics: sessionMetrics,
  },
  {
    key: "devices",
    label: "Devices",
    family: "devices",
    dimensions: ["deviceCategory"],
    metrics: SESSION_METRICS,
    attributes: (d) => (isSet(d.deviceCategory) ? { device: initcap(d.deviceCategory) } : null),
    toMetrics: sessionMetrics,
  },
  {
    key: "screens",
    label: "Screen sizes",
    family: "screens",
    dimensions: ["screenResolution"],
    metrics: SESSION_METRICS,
    attributes: (d) => (isSet(d.screenResolution) ? { screen: d.screenResolution } : null),
    toMetrics: sessionMetrics,
  },
  {
    key: "languages",
    label: "Languages",
    family: "languages",
    dimensions: ["languageCode"],
    metrics: SESSION_METRICS,
    attributes: (d) => (isSet(d.languageCode) ? { language: languageTag(d.languageCode) } : null),
    toMetrics: sessionMetrics,
  },
  {
    key: "browsers",
    label: "Browsers and versions",
    family: "browsers",
    dimensions: ["browser"],
    optionalDimensions: ["browserVersion"],
    metrics: SESSION_METRICS,
    attributes: (d) => {
      if (!isSet(d.browser)) return null;
      const name = browserName(d.browser);
      return { browser: name, browser_version: isSet(d.browserVersion) ? `${name} ${shortVersion(d.browserVersion)}` : "" };
    },
    toMetrics: sessionMetrics,
  },
  {
    key: "operating_systems",
    label: "Operating systems and versions",
    family: "os",
    dimensions: ["operatingSystem"],
    optionalDimensions: ["operatingSystemVersion"],
    metrics: SESSION_METRICS,
    attributes: (d) => {
      if (!isSet(d.operatingSystem)) return null;
      const name = osName(d.operatingSystem);
      return {
        os: name,
        os_version: isSet(d.operatingSystemVersion) ? `${name} ${shortVersion(d.operatingSystemVersion)}` : "",
      };
    },
    toMetrics: sessionMetrics,
  },
  {
    key: "events",
    label: "Custom events",
    family: "events",
    dimensions: ["eventName"],
    metrics: EVENT_METRICS,
    attributes: (d) => (isSet(d.eventName) && !GA4_INTERNAL_EVENTS.has(d.eventName) ? { event: d.eventName } : null),
    toMetrics: eventMetrics,
  },
  {
    // GA4's enhanced-measurement outbound click, stored as the Webyz
    // tracker's own event so it reads alongside tracked clicks everywhere.
    key: "outbound_links",
    label: "Outbound links",
    family: "events",
    dimensions: ["linkUrl"],
    metrics: EVENT_METRICS,
    filters: [
      { fieldName: "eventName", value: "click" },
      { fieldName: "outbound", value: "true" },
    ],
    attributes: (d) => {
      if (!isSet(d.linkUrl)) return null;
      const href = linkUrl(d.linkUrl);
      return { event: "Outbound Link: Click", outbound_url: href, outbound_domain: linkHost(href) };
    },
    toMetrics: eventMetrics,
  },
  {
    key: "downloads",
    label: "File downloads",
    family: "events",
    dimensions: ["linkUrl"],
    metrics: EVENT_METRICS,
    filters: [{ fieldName: "eventName", value: "file_download" }],
    attributes: (d) => (isSet(d.linkUrl) ? { event: "File Download", download: linkUrl(d.linkUrl) } : null),
    toMetrics: eventMetrics,
  },
  {
    key: "site_search",
    label: "Site search terms",
    family: "search",
    dimensions: ["searchTerm"],
    metrics: EVENT_METRICS,
    filters: [{ fieldName: "eventName", value: "view_search_results" }],
    attributes: (d) => (isSet(d.searchTerm) ? { search_term: d.searchTerm.trim() } : null),
    toMetrics: eventMetrics,
  },
];

/** Shown on the import screen, so nobody wonders where these went. */
export const GA4_NOT_IMPORTED = [
  "Exit pages: GA4 does not report them",
  "New vs returning visitors, cohorts and first-visit source: Webyz does not recognise a visitor across days",
  "Age, gender and interests: Google's ad profiling, left out on purpose",
  "Google Ads dimensions: only exist inside Google's ad system",
];

/** GA4 "YYYYMMDD" -> "YYYY-MM-DD". */
export const ga4Date = (value: string) =>
  /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null;

const METRIC_KEYS = [
  "visitors",
  "visits",
  "pageviews",
  "bounces",
  "visit_duration",
  "events",
  "scroll_depth",
  "scroll_depth_visits",
  "time_on_page",
  "time_on_page_visits",
] as const;

/** Adds `row` into `into`, summing rows with the same day, family and attributes. */
export const addImportedRow = (into: Map<string, ImportedRow>, row: ImportedRow) => {
  const { date, family, ...rest } = row;
  const attrs = Object.entries(rest)
    .filter(([k, v]) => !(METRIC_KEYS as readonly string[]).includes(k) && v)
    .sort(([a], [b]) => a.localeCompare(b));
  const key = `${date}\u0000${family}\u0000${JSON.stringify(attrs)}`;
  const existing = into.get(key);
  if (!existing) {
    into.set(key, { ...row });
    return;
  }
  for (const metric of METRIC_KEYS) {
    if (row[metric] !== undefined) existing[metric] = (existing[metric] ?? 0) + (row[metric] ?? 0);
  }
};

/**
 * One report's GA4 rows (dimension values in the order `requested`, date
 * first) as imported rows, summing rows that land on the same day, family
 * and attributes: GA4 splits "google / organic" from "google / cpc", which
 * differ in channel but not in source.
 */
export const mapReportRows = (
  spec: ReportSpec,
  requested: string[],
  rows: Array<{ dimensions: string[]; metrics: string[] }>,
  into: Map<string, ImportedRow> = new Map(),
): Map<string, ImportedRow> => {
  for (const row of rows) {
    const date = ga4Date(row.dimensions[0] ?? "");
    if (!date) continue;
    const dims: Record<string, string> = {};
    requested.forEach((name, i) => (dims[name] = row.dimensions[i + 1] ?? ""));
    const attributes = spec.attributes(dims);
    if (!attributes) continue;
    addImportedRow(into, { date, family: spec.family, ...attributes, ...spec.toMetrics(row.metrics) });
  }
  return into;
};
