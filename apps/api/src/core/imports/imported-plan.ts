import type { AnalyticsFilters } from "../../db/clickhouse/filters.js";

/**
 * Which imported rows can answer a dashboard question, Plausible's rule.
 *
 * Imported data is daily aggregates per report family (see migration 013):
 * a `sources` row holds a day's channel, source and UTM fields together, a
 * `locations` row its country, region and city. A breakdown and its filters
 * can be answered from imported data when every dimension involved lives in
 * one family: "source is Google, by campaign" reads `sources` rows where
 * source = google.com grouped by campaign. Dimensions from two families
 * ("country is India, by browser") cannot be combined from aggregates, so
 * imported data is left out and the response says so.
 *
 * The plan is pure; db/clickhouse/imported.ts turns it into SQL.
 */

/** Attribute columns of `imported_stats`, named like the dashboard's dimensions. */
export const IMPORT_COLUMNS = [
  "channel",
  "source",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "page",
  "hostname",
  "title",
  "entry_page",
  "exit_page",
  "country",
  "region",
  "city",
  "device",
  "screen",
  "browser",
  "browser_version",
  "os",
  "os_version",
  "language",
  "event",
  "outbound_url",
  "outbound_domain",
  "download",
  "search_term",
  "prop_key",
  "prop_value",
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/** Each family and the attributes its rows carry together. */
export const IMPORT_FAMILIES = {
  visitors: [],
  sources: ["channel", "source", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"],
  pages: ["page", "hostname"],
  titles: ["title"],
  entry_pages: ["entry_page"],
  exit_pages: ["exit_page"],
  locations: ["country", "region", "city"],
  devices: ["device"],
  screens: ["screen"],
  languages: ["language"],
  browsers: ["browser", "browser_version"],
  os: ["os", "os_version"],
  events: ["event", "outbound_url", "outbound_domain", "download"],
  search: ["search_term"],
  props: ["prop_key", "prop_value"],
} as const satisfies Record<string, readonly ImportColumn[]>;

export type ImportFamily = keyof typeof IMPORT_FAMILIES;

const FAMILY_OF = new Map<string, ImportFamily>();
for (const [family, columns] of Object.entries(IMPORT_FAMILIES) as Array<[ImportFamily, readonly ImportColumn[]]>) {
  for (const column of columns) FAMILY_OF.set(column, family);
}

/**
 * Dimensions that can filter imported rows but not group them: a page row's
 * hostname would count a visit once per page it saw on that host.
 */
const FILTER_ONLY = new Set<string>(["hostname"]);

/**
 * Families whose rows say nothing about visits as a whole, so they add no
 * bounces or visit seconds and must not dilute those rates either: a page
 * row's visits are visits that saw the page (Plausible counts imported page
 * rows the same way), an event row's are none.
 */
export const RATE_NEUTRAL_FAMILIES = new Set<ImportFamily>(["pages", "events", "search", "props"]);

export const familyOf = (dimension: string): ImportFamily | undefined => FAMILY_OF.get(dimension);

export type ImportedPlan = {
  family: ImportFamily;
  /** The request's filters, every one a column of `family`. */
  filters: AnalyticsFilters;
  /** The family adds no bounces or visit seconds (RATE_NEUTRAL_FAMILIES). */
  rateNeutral: boolean;
};

/**
 * The family that answers `dimension` (null for site totals and the graph)
 * under `filters`, or null when no single family can.
 */
export const planImported = (dimension: string | null, filters: AnalyticsFilters | undefined): ImportedPlan | null => {
  const applied = Object.fromEntries(
    Object.entries(filters ?? {}).filter(([, condition]) => condition && condition.value !== ""),
  ) as AnalyticsFilters;
  const keys = Object.keys(applied);

  if (dimension && FILTER_ONLY.has(dimension)) return null;
  if (!dimension && !keys.length) return { family: "visitors", filters: {}, rateNeutral: false };

  const families = new Set<ImportFamily>();
  for (const key of dimension ? [dimension, ...keys] : keys) {
    const family = FAMILY_OF.get(key);
    if (!family) return null;
    families.add(family);
  }
  if (families.size !== 1) return null;
  const family = [...families][0];
  return { family, filters: applied, rateNeutral: RATE_NEUTRAL_FAMILIES.has(family) };
};
