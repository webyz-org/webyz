import { classifyChannel } from "../../ingest/helpers/channel.js";
import { shortVersion } from "../../utils/version.js";
import type { GeoNames } from "./geo-names.js";
import { addImportedRow, initcap, linkHost, type ImportedMetrics, type ImportedRow } from "./ga4-reports.js";
import type { ImportFamily } from "./imported-plan.js";

/**
 * Plausible's data export, read into `imported_stats`.
 *
 * Plausible (site settings, Imports & Exports) exports a zip of CSVs, one per
 * report, named `imported_<report>_<YYYYMMDD>_<YYYYMMDD>.csv` (or without the
 * `imported_` prefix), with a header row and one row per local day of the
 * site and value. The column layout below is Plausible's own, from
 * `Plausible.Exports` and `Plausible.Imported.CSVImporter` in
 * github.com/plausible/analytics (read at commit e8f5220, October 2026).
 * Columns are read by header name, so an older export without the newer
 * scroll depth and time on page columns still imports.
 *
 * What maps where, and what does not:
 * - every report Plausible exports becomes the matching Webyz dimension,
 *   exit pages included, which GA4 cannot provide;
 * - regions and cities arrive as codes and GeoNames ids and are named from
 *   Webyz's own geo database (geo-names.ts), so they read like tracked rows;
 * - outbound link clicks and file downloads are Plausible's `Outbound Link:
 *   Click` and `File Download` events, the same names the Webyz tracker
 *   sends, so they feed the outbound report and downloads too;
 * - each CSV is one report family (core/imports/imported-plan.ts), its
 *   columns kept together per row, so filters within a family work on
 *   imported data as they do in Plausible;
 * - custom properties are stored (family `props`) but not yet shown: the
 *   export does not say which event a property belongs to;
 * - screen sizes, languages and page titles are not in Plausible's export.
 */

export const PLAUSIBLE_REPORTS = [
  "imported_visitors",
  "imported_sources",
  "imported_pages",
  "imported_entry_pages",
  "imported_exit_pages",
  "imported_custom_events",
  "imported_locations",
  "imported_devices",
  "imported_browsers",
  "imported_operating_systems",
  "imported_custom_props",
] as const;

export type PlausibleReport = (typeof PLAUSIBLE_REPORTS)[number];

/** Shown on the import screen. */
export const PLAUSIBLE_NOT_IMPORTED = [
  "Screen sizes, languages and page titles: not in Plausible's export",
  "Custom properties: stored, shown once Webyz has a report of properties across events",
];

/** `imported_devices_20240101_20241231.csv` -> report and inclusive dates, or null. */
export const parsePlausibleFilename = (
  filename: string,
): { report: PlausibleReport; start: string; end: string } | null => {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const match = /^(?:imported_)?([a-z_]+)_(\d{8})_(\d{8})\.csv$/.exec(base);
  if (!match) return null;
  const report = `imported_${match[1]}` as PlausibleReport;
  if (!(PLAUSIBLE_REPORTS as readonly string[]).includes(report)) return null;
  const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return { report, start: iso(match[2]), end: iso(match[3]) };
};

/**
 * RFC 4180 CSV as ClickHouse writes CSVWithNames: fields optionally in double
 * quotes, a doubled quote inside one, newlines allowed inside quotes, `\N`
 * for NULL (returned as ""). Returns the header and the rows.
 */
export const parseCsv = (text: string): { header: string[]; rows: string[][] } => {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  let wasQuoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      wasQuoted = true;
    } else if (ch === ",") {
      record.push(!wasQuoted && field === "\\N" ? "" : field);
      field = "";
      wasQuoted = false;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(!wasQuoted && field === "\\N" ? "" : field);
      if (record.length > 1 || record[0] !== "") records.push(record);
      record = [];
      field = "";
      wasQuoted = false;
    } else {
      field += ch;
    }
  }
  if (field !== "" || wasQuoted || record.length) {
    record.push(!wasQuoted && field === "\\N" ? "" : field);
    if (record.length > 1 || record[0] !== "") records.push(record);
  }
  const [header = [], ...rows] = records;
  return { header: header.map((h) => h.trim()), rows };
};

type Row = Record<string, string>;

const n = (row: Row, key: string) => {
  const value = Number(row[key]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
};

const ZERO: ImportedMetrics = { visitors: 0, visits: 0, pageviews: 0, bounces: 0, visit_duration: 0, events: 0 };

/** The session-shaped metrics most Plausible reports carry. */
const sessionMetrics = (row: Row, visitsKey = "visits"): ImportedMetrics => ({
  ...ZERO,
  visitors: n(row, "visitors"),
  visits: n(row, visitsKey),
  pageviews: n(row, "pageviews"),
  bounces: n(row, "bounces"),
  visit_duration: n(row, "visit_duration"),
});

const eventMetrics = (row: Row): ImportedMetrics => ({ ...ZERO, visitors: n(row, "visitors"), events: n(row, "events") });

/** Plausible's OS names that differ from Webyz's. */
const OS_NAMES: Record<string, string> = { Mac: "macOS", "GNU/Linux": "Linux" };

/**
 * Plausible names a search engine ("Google") where Webyz records the referrer
 * host; used only when the export carries no referrer for the row.
 */
const SOURCE_HOSTS: Record<string, string> = {
  Google: "google.com",
  Bing: "bing.com",
  DuckDuckGo: "duckduckgo.com",
  "Yahoo!": "search.yahoo.com",
  Ecosia: "ecosia.org",
  Baidu: "baidu.com",
  Yandex: "yandex.ru",
  Brave: "search.brave.com",
  Qwant: "qwant.com",
};

/** Webyz's source label (the referrer host, or "(direct)") for a sources row. */
export const plausibleSource = (row: Row): string => {
  const referrer = (row.referrer ?? "").trim().toLowerCase();
  if (referrer) {
    const host = referrer.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/^www\./, "");
    if (host) return host;
  }
  const source = (row.source ?? "").trim();
  // Plausible falls back to utm_source for referrer_source; Webyz's source is
  // the referrer only, so a tagged visit with no referrer is direct here.
  if (!source || source === "Direct / None" || source === (row.utm_source ?? "").trim()) return "(direct)";
  return SOURCE_HOSTS[source] ?? source.toLowerCase();
};

/**
 * Events Plausible records for its own measurement, which its export lists
 * among custom events: `engagement` (time on page and scroll depth, sent as
 * a page is left) and the older `pageleave`. They are not anything the site
 * owner tracks, so they are not imported as custom events.
 */
const PLAUSIBLE_INTERNAL_EVENTS = new Set(["engagement", "pageleave"]);

/**
 * A region as Webyz names it: an ISO 3166-2 code ("US-CA") through the geo
 * database, or a value that is already a name (Webyz's own export writes the
 * name when the database has no code for it) as it is.
 */
const regionName = (value: string | undefined, geo: GeoNames | null) => {
  const v = (value ?? "").trim();
  if (!v) return "";
  if (/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(v)) return geo?.regions.get(v) ?? "";
  return v;
};

const OUTBOUND_EVENT = "Outbound Link: Click";
const DOWNLOAD_EVENT = "File Download";

/**
 * Map one report's parsed rows. Rows outside [from, to] are dropped, which is
 * how the import stays clear of days Webyz tracked itself.
 */
export const mapPlausibleRows = (
  report: PlausibleReport,
  header: string[],
  rows: string[][],
  range: { from: string; to: string },
  geo: GeoNames | null,
): ImportedRow[] => {
  const out = new Map<string, ImportedRow>();
  const push = (date: string, family: ImportFamily, attrs: Partial<Record<string, string>>, metrics: ImportedMetrics) =>
    addImportedRow(out, { date, family, ...attrs, ...metrics });

  for (const values of rows) {
    const row: Row = {};
    header.forEach((key, i) => (row[key] = values[i] ?? ""));
    const date = row.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || date < range.from || date > range.to) continue;

    switch (report) {
      case "imported_visitors":
        push(date, "visitors", {}, sessionMetrics(row));
        break;

      case "imported_sources": {
        const source = plausibleSource(row);
        const medium = (row.utm_medium ?? "").trim();
        const utmSource = (row.utm_source ?? "").trim();
        const channel =
          source === "(direct)" && !medium && !utmSource
            ? "Direct"
            : classifyChannel({
                utmMedium: medium.toLowerCase(),
                utmSource: utmSource.toLowerCase(),
                referrerDomain: source === "(direct)" ? "" : source,
              });
        push(
          date,
          "sources",
          {
            channel,
            source,
            utm_source: utmSource,
            utm_medium: medium,
            utm_campaign: (row.utm_campaign ?? "").trim(),
            utm_content: (row.utm_content ?? "").trim(),
            utm_term: (row.utm_term ?? "").trim(),
          },
          sessionMetrics(row),
        );
        break;
      }

      case "imported_pages": {
        if (!row.page) break;
        // Plausible's convention, kept: an imported page row adds visitors,
        // visits and views but no bounces or visit seconds.
        push(
          date,
          "pages",
          { page: row.page, hostname: (row.hostname ?? "").trim().toLowerCase().replace(/^www\./, "") },
          {
            ...ZERO,
            visitors: n(row, "visitors"),
            visits: n(row, "visits"),
            pageviews: n(row, "pageviews"),
            scroll_depth: n(row, "total_scroll_depth"),
            scroll_depth_visits: n(row, "total_scroll_depth_visits"),
            time_on_page: n(row, "total_time_on_page"),
            time_on_page_visits: n(row, "total_time_on_page_visits"),
          },
        );
        break;
      }

      case "imported_entry_pages":
        if (row.entry_page) push(date, "entry_pages", { entry_page: row.entry_page }, sessionMetrics(row, "entrances"));
        break;

      case "imported_exit_pages":
        if (row.exit_page) push(date, "exit_pages", { exit_page: row.exit_page }, sessionMetrics(row, "exits"));
        break;

      case "imported_custom_events": {
        const name = row.name;
        if (!name || PLAUSIBLE_INTERNAL_EVENTS.has(name)) break;
        const url = (row.link_url ?? "").trim().replace(/#.*$/, "");
        const attrs: Record<string, string> = { event: name };
        if (url && name === OUTBOUND_EVENT) Object.assign(attrs, { outbound_url: url, outbound_domain: linkHost(url) });
        else if (url && name === DOWNLOAD_EVENT) attrs.download = url;
        push(date, "events", attrs, eventMetrics(row));
        // The path Plausible keeps on 404 and similar events, for a later properties report.
        if (row.path) push(date, "props", { prop_key: `${name}\u0000path`, prop_value: row.path }, eventMetrics(row));
        break;
      }

      case "imported_custom_props":
        if (row.property) push(date, "props", { prop_key: row.property, prop_value: row.value ?? "" }, eventMetrics(row));
        break;

      case "imported_locations": {
        const country = (row.country ?? "").trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(country) || country === "ZZ") break;
        push(
          date,
          "locations",
          {
            country,
            region: regionName(row.region, geo),
            city: geo?.cities.get(Number(row.city)) ?? "",
          },
          sessionMetrics(row),
        );
        break;
      }

      case "imported_devices":
        if (row.device) push(date, "devices", { device: initcap(row.device) }, sessionMetrics(row));
        break;

      case "imported_browsers": {
        const browser = (row.browser ?? "").trim();
        if (!browser || browser === "(not set)") break;
        const version = (row.browser_version ?? "").trim();
        push(
          date,
          "browsers",
          { browser, browser_version: version && version !== "(not set)" ? `${browser} ${shortVersion(version)}` : "" },
          sessionMetrics(row),
        );
        break;
      }

      case "imported_operating_systems": {
        const raw = (row.operating_system ?? "").trim();
        if (!raw || raw === "(not set)") break;
        const os = OS_NAMES[raw] ?? raw;
        const version = (row.operating_system_version ?? "").trim();
        push(
          date,
          "os",
          { os, os_version: version && version !== "(not set)" ? `${os} ${shortVersion(version)}` : "" },
          sessionMetrics(row),
        );
        break;
      }
    }
  }
  return [...out.values()];
};
