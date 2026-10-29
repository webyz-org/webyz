# Importing your history

Switching analytics tools usually means starting from an empty dashboard. Webyz can bring a site's history across from **Google Analytics 4** directly, or from **CSV files** in Plausible's import format: a Plausible export works as it is, and any other tool's data can be converted to it ([CSV format](#csv-format)). The dashboard then starts with your past traffic instead of nothing.

Imports and the export live in the site's settings under **Imports & exports**. The owner and admins of a site can import and export; viewers cannot.

## How imported data is used

- **Only days before tracking began.** An import stops the day before Webyz recorded its first visit for the site, so no day is counted twice. If you install Webyz first and import later, everything up to the day before the first tracked visit comes across.
- **Merged into the dashboard.** The overview, the graph (daily, weekly and monthly), every breakdown, goals, custom events, the outbound links and downloads reports, shared dashboards and CSV exports add imported days to their numbers. A line under the overview says when imported data is included.
- **Filters, the way Plausible does them.** Imported data is daily totals per report, kept together the way the source reported them: a source with its UTM campaign, a country with its region and city, a browser with its version. A filter keeps imported days when it and the report come from the same imported report: "source is Google" on the campaigns list, "country is India" on regions or on the overview totals, "page is /pricing" on the pages list. Across two reports ("country is India" on browsers) aggregates cannot answer, so imported days are left out there and the dashboard says so. The hourly graph has nothing to show for imported days, since they are daily.
- **The Pages report too.** Imported pages add views, visits and visitors to the Pages report and a page's detail, and Plausible exports add scroll depth and time on page. Imported page rows never change a page's bounce rate or visit duration (Plausible's rule); a page's sources, devices, countries and events stay tracked-only, because imported rows do not say which page a source came to.
- **Visitors are summed by day.** Over a range of days, imported visitors are the sum of each day's visitors, so someone who came on two days counts twice. Tracked days count unique visitors exactly.
- **Never billed.** Imported rows are not events and do not count towards your plan's allowance.
- **Up to five imports per site,** Google Analytics and CSV mixed, as long as their dates do not overlap: a day can only come from one import. Deleting an import removes its data and leaves tracked data untouched. Deleting the site or your account deletes its imported data too.

Labels are written the way Webyz writes them, so imported and tracked rows line up: channels follow Webyz's own rules (visits from ChatGPT, Perplexity and other assistants land in **AI Assistants** whatever the source tool called them), sources are referrer hosts (`google.com`), and browser and operating system versions are shown as major.minor (`Chrome 128.0`, `macOS 14.4`) for every source.

## From Google Analytics 4

1. In **Import data**, choose **Connect Google Analytics** and sign in with the Google account that can read the property. Webyz asks for read-only access.
2. Pick the GA4 property and, optionally, a date range. Without one the import starts at the property's creation date.
3. Start. The import runs on the server and the card shows its progress. You can leave the page.

Webyz keeps the Google grant only while the import runs, encrypted, and revokes it when the import ends, whether it succeeded or not.

**Imported:** visits, visitors, pageviews, bounce rate and visit duration; channels and sources; UTM source, medium, campaign, content and term; pages, entry pages and page titles; hostnames; countries, regions and cities; devices, browsers and operating systems with versions; screen sizes; languages; custom events; outbound link clicks; file downloads; site search terms.

**Not imported, on purpose:** new vs returning visitors, cohorts and first-visit attribution (Webyz does not recognise a visitor across days, by design); age, gender and interests (Google's ad profiling); Google Ads dimensions. GA4 has no exit pages, so exit pages start with the first tracked day. GA4 counts a bounce as a session that was not engaged, which is close to Webyz's definition (one pageview, no custom event) but not the same.

If Google does not offer one of the reports for your property, the import skips it and lists it on the import card.

## From CSV files

1. Get the files. From Plausible: open the site's settings, then **Imports & Exports**, and export your data; Plausible gives you a zip. From another tool: write the files described under [CSV format](#csv-format).
2. In Webyz's **Imports & exports**, choose **Import from CSV** and pick or drag in the CSV files, or the zip they came in. Webyz shows which of the report files it found and the dates they cover.
3. Choose **Confirm import**. The files are read in your browser and uploaded in small pieces; keep the tab open until it finishes. An upload interrupted for more than an hour is cancelled and its partial data removed; delete it and start again.

Every file is optional except `imported_visitors`, which carries the site totals: without it the overview would show no imported traffic while the breakdowns did. (Plausible lets you leave it out; Webyz does not, for that reason.)

**Imported from a Plausible export:** visits, visitors, pageviews, bounce rate and visit duration; sources, channels and UTM fields; pages with scroll depth and time on page; entry pages; exit pages; custom events, including outbound link clicks and file downloads (Plausible and Webyz use the same event names); countries, regions and cities (named from Webyz's own location database, so they match tracked rows); devices; browsers and operating systems with versions.

**Stored for later:** custom properties (Plausible's export does not say which event a property belongs to, so they wait for a report of properties across events).

**Not in the format:** screen sizes, languages and page titles.

## CSV format

The same format Plausible imports and exports, so files that work with one work with the other. One file per report, each optional except `imported_visitors`:

- **Name:** `imported_<report>_<first day>_<last day>.csv` with days as `YYYYMMDD`, for example `imported_devices_20230209_20240123.csv`. The `imported_` prefix may be left off.
- **Content:** a header row with the column names below, then one row per day and value. Columns are matched by name, so their order does not matter, and extra columns are ignored. Fields may be quoted (`"..."`, with `""` for a quote inside); `\N` means empty.
- **Dates** are `YYYY-MM-DD`, the day in the site's own timezone.
- **Numbers are totals, not averages:** `visit_duration` is the total seconds of the day's visits, `bounces` the number of one-page visits. Webyz divides by `visits` itself.
- **Rows outside the range** in the file name, or on or after the first day Webyz tracked the site, are skipped.
- A zip of the files is accepted too.

| Report | Columns |
| --- | --- |
| `imported_visitors` | `date`, `visitors`, `pageviews`, `bounces`, `visits`, `visit_duration` |
| `imported_sources` | `date`, `source`, `referrer`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `pageviews`, `visitors`, `visits`, `visit_duration`, `bounces` |
| `imported_pages` | `date`, `hostname`, `page`, `visits`, `visitors`, `pageviews`, and optionally `total_scroll_depth`, `total_scroll_depth_visits`, `total_time_on_page`, `total_time_on_page_visits` |
| `imported_entry_pages` | `date`, `entry_page`, `visitors`, `entrances`, `visit_duration`, `bounces`, `pageviews` |
| `imported_exit_pages` | `date`, `exit_page`, `visitors`, `visit_duration`, `exits`, `bounces`, `pageviews` |
| `imported_custom_events` | `date`, `name`, `link_url`, `path`, `visitors`, `events` |
| `imported_locations` | `date`, `country`, `region`, `city`, `visitors`, `visits`, `visit_duration`, `bounces`, `pageviews` |
| `imported_devices` | `date`, `device`, `visitors`, `visits`, `visit_duration`, `bounces`, `pageviews` |
| `imported_browsers` | `date`, `browser`, `browser_version`, `visitors`, `visits`, `visit_duration`, `bounces`, `pageviews` |
| `imported_operating_systems` | `date`, `operating_system`, `operating_system_version`, `visitors`, `visits`, `visit_duration`, `bounces`, `pageviews` |
| `imported_custom_props` | `date`, `property`, `value`, `visitors`, `events` |

What the values mean:

- `source` is a name ("Google"), `referrer` the referring host with an optional path (`news.ycombinator.com/item`). Webyz shows the referrer host as the source, `(direct)` when there is none, and works out the channel itself. Plausible's "Direct / None" means direct.
- `page`, `entry_page` and `exit_page` are paths (`/pricing`). `hostname` is the site's host.
- `country` is an ISO 3166-1 code (`IN`), `region` an ISO 3166-2 code (`IN-KL`), `city` a GeoNames id (`1273874`, `0` for unknown). Webyz names regions and cities from its location database.
- `device` is `Desktop`, `Mobile`, `Tablet` or `Laptop`.
- In `imported_custom_events`, `link_url` is the destination of an `Outbound Link: Click` or `File Download` event and `path` the page of a `404`; both are empty for other events. `engagement` and `pageleave` rows are Plausible's own measurement and are skipped.
- `total_scroll_depth` sums each visit's deepest scroll on the page in percent, over `total_scroll_depth_visits` visits; `total_time_on_page` sums engaged seconds over `total_time_on_page_visits` visits.
- Browser and OS versions are shown as major.minor, whatever detail the file has.

## Export

**Export data** gives you the site's whole tracked history as one zip of CSVs in the [CSV format](#csv-format) above, named like Plausible's (`example_com_20261005.zip`). It imports back into Webyz with **Import from CSV**, into another Webyz site, or into Plausible, as it is.

- **What is in it:** every report the format has, daily in the site's timezone, from the first tracked day the plan's retention still shows: visitors and visits, sources and UTM, pages with scroll depth and time on page, entry and exit pages, custom events with outbound link and download URLs, locations, devices, browsers, operating systems and custom properties.
- **Not in it:** imported history (as in Plausible's export).
- **Prepared, then kept for seven days,** as in Plausible: **Export to CSV** builds the zip in the background, the card shows it with its size once it is ready, and the person who asked gets an email. Download it as often as you like until it expires; the trash icon deletes it sooner. A site keeps one export: preparing a new one replaces the last.
- **Any plan:** taking your data with you is not a paid feature.

Two things the format itself cannot carry exactly: a city goes out as its GeoNames id, so a city name the location database does not know is exported as unknown (`0`); and custom events are counted per event and link, so someone who clicked two different outbound links counts as a visitor of each. Clicks, events, pageviews and visits are exact. Exporting a site and importing the zip into an empty site gives the same reports, which is how this was tested.

## Self-hosted installs

Google Analytics import needs the Google OAuth client that Google sign-in uses (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), with:

- the redirect URI `https://<your API host>/api/v1/imports/ga4/callback` registered on the OAuth client (or set `GA4_IMPORT_REDIRECT_URI`);
- the **Google Analytics Admin API** and **Google Analytics Data API** enabled in the Google Cloud project;
- the `analytics.readonly` scope on the consent screen. Google classes it as sensitive, so until your consent screen is verified only accounts listed as test users can connect.

The bundled Caddy allows 2 MB request bodies on the import upload route (`infra/caddy/Caddyfile`). Behind your own nginx, allow request bodies of up to 2 MB on the import routes; the [example config](../infra/reverse-proxy/nginx.conf.example) has the location block. Regions and cities are named from the GeoLite2 database, so set `MAXMIND_LICENSE_KEY` (see [Configuration](configuration.md)); without it countries import and regions and cities are skipped.

Export data writes its zips to `EXPORTS_DIR`, the `exports` volume in the compose stack (see [Configuration](configuration.md)).

The endpoints behind both imports and the export are in the [HTTP API](api.md) reference.
