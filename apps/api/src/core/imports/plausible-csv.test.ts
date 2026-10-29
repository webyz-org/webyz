import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildGeoNames } from "./geo-names.js";
import { mapPlausibleRows, parseCsv, parsePlausibleFilename, plausibleSource } from "./plausible-csv.js";

const range = { from: "2024-01-01", to: "2024-12-31" };

/** Parse and map one CSV the way an uploaded chunk is. */
const map = (filename: string, csv: string, geo: Parameters<typeof mapPlausibleRows>[4] = null) => {
  const meta = parsePlausibleFilename(filename);
  assert.ok(meta, filename);
  const { header, rows } = parseCsv(csv);
  return mapPlausibleRows(meta.report, header, rows, range, geo);
};

type Row = ReturnType<typeof map>[number];
/** Rows with this value in a column (any value when `value` is omitted). */
const pick = (rows: ReturnType<typeof map>, column: keyof Row, value?: string) =>
  rows.filter((r) => (value === undefined ? Boolean(r[column]) : r[column] === value));
/** Visitors per value of a column, summed across rows. */
const by = (rows: ReturnType<typeof map>, column: keyof Row, metric: keyof Row = "visitors") => {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const key = r[column] as string | undefined;
    if (key) out[key] = (out[key] ?? 0) + Number(r[metric] ?? 0);
  }
  return out;
};

describe("Plausible export files", () => {
  it("reads the report and range from the file name, with or without the prefix", () => {
    assert.deepEqual(parsePlausibleFilename("imported_devices_20240101_20241231.csv"), {
      report: "imported_devices",
      start: "2024-01-01",
      end: "2024-12-31",
    });
    assert.equal(parsePlausibleFilename("plausible_io_20241231/browsers_20230101_20231231.csv")?.report, "imported_browsers");
    assert.equal(parsePlausibleFilename("my_data.csv"), null);
    assert.equal(parsePlausibleFilename("imported_nonsense_20240101_20241231.csv"), null);
  });

  it("parses ClickHouse CSV: quotes, doubled quotes, commas and newlines inside quotes, \\N", () => {
    const { header, rows } = parseCsv('date,name,link_url\r\n"2024-01-01","Say ""hi"", twice","a\nb"\n2024-01-02,plain,\\N\n');
    assert.deepEqual(header, ["date", "name", "link_url"]);
    assert.deepEqual(rows, [
      ["2024-01-01", 'Say "hi", twice', "a\nb"],
      ["2024-01-02", "plain", ""],
    ]);
  });
});

describe("mapping Plausible reports onto Webyz labels", () => {
  it("visitors become the site totals, keeping total seconds and bounces", () => {
    const rows = map(
      "imported_visitors_20240101_20241231.csv",
      "date,visitors,pageviews,bounces,visits,visit_duration\n2024-03-01,10,25,4,12,600\n2023-12-31,99,99,99,99,99\n",
    );
    assert.deepEqual(rows, [
      { date: "2024-03-01", family: "visitors", visitors: 10, visits: 12, pageviews: 25, bounces: 4, visit_duration: 600, events: 0 },
    ]);
  });

  it("sources keep channel, source and UTM fields together in one row", () => {
    const csv = [
      "date,source,referrer,utm_source,utm_medium,utm_campaign,utm_content,utm_term,pageviews,visitors,visits,visit_duration,bounces",
      '2024-03-01,Google,www.google.com,"","","","","",5,4,4,100,1',
      "2024-03-01,ChatGPT,chatgpt.com/c/abc,,,,,,2,2,2,10,0",
      "2024-03-01,Facebook,lm.facebook.com,,,,,,1,1,1,0,1",
      "2024-03-01,Direct / None,,,,,,,3,3,3,0,3",
      "2024-03-01,newsletter,,newsletter,email,spring,,,6,5,5,50,2",
    ].join("\n");
    const rows = map("imported_sources_20240101_20241231.csv", csv);
    assert.ok(rows.every((r) => r.family === "sources"));
    assert.deepEqual(by(rows, "source"), { "google.com": 4, "chatgpt.com": 2, "lm.facebook.com": 1, "(direct)": 8 });
    assert.deepEqual(by(rows, "channel"), { "Organic Search": 4, "AI Assistants": 2, "Organic Social": 1, Direct: 3, Email: 5 });
    const tagged = pick(rows, "utm_campaign", "spring")[0];
    assert.deepEqual([tagged.source, tagged.channel, tagged.utm_source, tagged.utm_medium, tagged.visits], [
      "(direct)",
      "Email",
      "newsletter",
      "email",
      5,
    ]);
  });

  it("names a search engine from Plausible's source when no referrer came with it", () => {
    assert.equal(plausibleSource({ source: "Bing", referrer: "", utm_source: "" }), "bing.com");
    assert.equal(plausibleSource({ source: "Hacker News", referrer: "news.ycombinator.com/item", utm_source: "" }), "news.ycombinator.com");
  });

  it("pages keep hostname and engagement, and add no bounces or seconds", () => {
    const pages = map(
      "imported_pages_20240101_20241231.csv",
      "date,hostname,page,visits,visitors,pageviews,total_scroll_depth,total_scroll_depth_visits,total_time_on_page,total_time_on_page_visits\n2024-03-01,www.example.com,/pricing,8,7,10,400,6,120,5\n",
    );
    assert.deepEqual(pages, [
      {
        date: "2024-03-01", family: "pages", page: "/pricing", hostname: "example.com",
        visitors: 7, visits: 8, pageviews: 10, bounces: 0, visit_duration: 0, events: 0,
        scroll_depth: 400, scroll_depth_visits: 6, time_on_page: 120, time_on_page_visits: 5,
      },
    ]);
  });

  it("entry and exit pages are their own families, exits included", () => {
    const entries = map(
      "imported_entry_pages_20240101_20241231.csv",
      "date,entry_page,visitors,entrances,visit_duration,bounces,pageviews\n2024-03-01,/pricing,5,6,300,2,9\n",
    );
    assert.deepEqual([entries[0].family, entries[0].entry_page, entries[0].visits, entries[0].bounces], ["entry_pages", "/pricing", 6, 2]);
    const exits = map(
      "imported_exit_pages_20240101_20241231.csv",
      "date,exit_page,visitors,visit_duration,exits,bounces,pageviews\n2024-03-01,/thanks,3,90,4,1,5\n",
    );
    assert.deepEqual([exits[0].family, exits[0].exit_page, exits[0].visits], ["exit_pages", "/thanks", 4]);
  });

  it("custom events carry their link in the same row; Plausible's own pings are skipped", () => {
    const csv = [
      "date,name,link_url,path,visitors,events",
      "2024-03-01,Signup,,,3,4",
      "2024-03-01,Outbound Link: Click,https://www.github.com/x#readme,,2,3",
      "2024-03-01,File Download,https://example.com/a.pdf,,1,1",
      "2024-03-01,404,,/missing,1,2",
      "2024-03-01,engagement,,,9,46",
    ].join("\n");
    const rows = map("imported_custom_events_20240101_20241231.csv", csv);
    const events = rows.filter((r) => r.family === "events");
    assert.deepEqual(by(events, "event", "events"), { Signup: 4, "Outbound Link: Click": 3, "File Download": 1, "404": 2 });
    const click = pick(events, "event", "Outbound Link: Click")[0];
    assert.deepEqual([click.outbound_url, click.outbound_domain], ["https://www.github.com/x", "github.com"]);
    assert.equal(pick(events, "event", "File Download")[0].download, "https://example.com/a.pdf");
    assert.deepEqual(
      rows.filter((r) => r.family === "props").map((r) => [r.prop_key, r.prop_value, r.events]),
      [["404\u0000path", "/missing", 2]],
    );
  });

  it("names regions and cities from the geo database in the same row as the country", () => {
    const geo = {
      cities: new Map([[5391959, "San Francisco"]]),
      regions: new Map([["US-CA", "California"]]),
      regionCodes: new Map(),
      cityIds: new Map(),
    };
    const csv = "date,country,region,city,visitors,visits,visit_duration,bounces,pageviews\n2024-03-01,US,US-CA,5391959,4,4,40,1,6\n2024-03-01,DE,DE-ZZ,0,2,2,0,0,2\n";
    const rows = map("imported_locations_20240101_20241231.csv", csv, geo);
    assert.deepEqual(rows.map((r) => [r.country, r.region, r.city, r.visitors]), [
      ["US", "California", "San Francisco", 4],
      ["DE", "", "", 2],
    ]);
    assert.deepEqual(map("imported_locations_20240101_20241231.csv", csv).map((r) => r.region), ["", ""]);
    // A region written as a name (Webyz's export does so when it has no code) is kept.
    const named = map(
      "imported_locations_20240101_20241231.csv",
      "date,country,region,city,visitors,visits,visit_duration,bounces,pageviews\n2024-03-01,DE,Berlin,0,1,1,0,0,1\n",
      geo,
    );
    assert.equal(named[0].region, "Berlin");
  });

  it("devices, browsers and operating systems read like tracked rows, versions major.minor", () => {
    const devices = map("imported_devices_20240101_20241231.csv", "date,device,visitors,visits,visit_duration,bounces,pageviews\n2024-03-01,Desktop,3,3,0,0,3\n");
    assert.equal(devices[0].device, "Desktop");
    const os = map(
      "imported_operating_systems_20240101_20241231.csv",
      "date,operating_system,operating_system_version,visitors,visits,visit_duration,bounces,pageviews\n2024-03-01,Mac,14.4,2,2,0,0,2\n2024-03-01,GNU/Linux,(not set),1,1,0,0,1\n2024-03-01,Mac,10.15.7,1,1,0,0,1\n",
    );
    assert.deepEqual(os.map((r) => [r.os, r.os_version]), [
      ["macOS", "macOS 14.4"],
      ["Linux", ""],
      ["macOS", "macOS 10.15"],
    ]);
    const browsers = map(
      "imported_browsers_20240101_20241231.csv",
      "date,browser,browser_version,visitors,visits,visit_duration,bounces,pageviews\n2024-03-01,Firefox,129.0,1,1,0,0,1\n",
    );
    assert.deepEqual([browsers[0].browser, browsers[0].browser_version], ["Firefox", "Firefox 129.0"]);
  });

  it("still imports an older export that lacks the newer page columns", () => {
    const rows = map("imported_pages_20240101_20241231.csv", "date,hostname,page,visits,visitors,pageviews\n2024-03-01,example.com,/,1,1,1\n");
    assert.equal(rows[0].scroll_depth, 0);
  });
});

describe("buildGeoNames", () => {
  it("collects every record the search tree points at", () => {
    // Two nodes; node 0 points at node 1 and a record, node 1 at two records.
    const records: Record<number, unknown> = {
      10: { country: { iso_code: "US" }, subdivisions: [{ iso_code: "CA", names: { en: "California" } }], city: { geoname_id: 1, names: { en: "San Francisco" } } },
      11: { country: { iso_code: "IN" }, subdivisions: [{ iso_code: "KA", names: { en: "Karnataka" } }], city: { geoname_id: 2, names: { en: "Bengaluru" } } },
    };
    const tree: Record<number, [number, number]> = { 0: [1, 10], 7: [11, 10] };
    const geo = buildGeoNames({
      metadata: { nodeCount: 2, nodeByteSize: 7 },
      walker: { left: (o) => tree[o][0], right: (o) => tree[o][1] },
      resolveDataPointer: (p) => records[p] as never,
    });
    assert.deepEqual([...geo.cities], [[1, "San Francisco"], [2, "Bengaluru"]]);
    assert.equal(geo.regions.get("IN-KA"), "Karnataka");
    assert.equal(geo.regionCodes.get("IN\u0000Karnataka"), "IN-KA");
    assert.equal(geo.cityIds.get("US\u0000San Francisco"), 1);
  });
});
