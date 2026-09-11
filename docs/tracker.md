# The tracker

One script tag, served by your Webyz API. It records pageviews automatically, follows client-side navigation in single-page apps, and sends custom events when you ask it to.

```html
<script defer src="https://api.example.com/js/script.js"
  data-site-id="YOUR_SITE_ID"
  data-endpoint="https://api.example.com/api/v1/track"></script>
```

Both attributes are required. The site id is on the setup screen after you add a website and in Site settings. The script is about 7 KB gzipped, loads with `defer`, and never blocks rendering.

## Options

All configuration is `data-*` attributes on the script tag.

| Attribute | Default | Effect |
| --- | --- | --- |
| `data-site-id` | required | Which website the events belong to |
| `data-endpoint` | required | Where to send them, normally `<api>/api/v1/track` |
| `data-domain` | page hostname | Report a different hostname, e.g. one site served from several domains |
| `data-auto-track` | `true` | Set `false` to send nothing automatically and call the API yourself |
| `data-track-localhost` | `false` | Set `true` to record traffic from `localhost` while developing |
| `data-exclude-search` | `false` | Set `true` to drop the query string from recorded URLs |
| `data-exclude-hash` | `false` | Set `true` to drop the fragment from recorded URLs |
| `data-hash-routing` | `false` | Set `true` for apps that route on the fragment (`/#/about`): a `hashchange` counts as a pageview and the fragment stays in the path |
| `data-outbound-links` | `false` | Set `true` to send an `Outbound Link: Click` event, with the destination as the `href` property, when a visitor clicks a link to another host |
| `data-file-downloads` | `false` | Set `true` to send a `File Download` event (`href` property) for clicks on links to files; `data-file-types="pdf,zip"` replaces the default extension list |
| `data-track-404` | `false` | Set `true` to send a `404` event (`page` property) on pages that carry `<meta name="webyz-404">` |
| `data-respect-dnt` | `true` | Set `false` to record visitors who have Do Not Track on |
| `data-debug` | `false` | Set `true` to log what the script does to the console |

## What is sent

For each pageview or event: the page URL and title, the referrer, the browser language and screen size, a timestamp, and any custom properties you add. When a page is hidden, loses focus or is left, the script also sends an engagement report: how many milliseconds the page was actually visible since the last report and the deepest scroll position as a percentage. The server adds that time to the visit, so a one-page visit that was read for two minutes is a two minute visit rather than 0 s, and stores the report per page for time-on-page and scroll depth. Engagement reports are not events: they are not billed and do not appear as activity. Nothing identifies the visitor: no cookie, no local storage, no fingerprint. The server derives a visitor id from a hash of the site, IP address, user agent and a salt that rotates every day, so a person is one visitor within a day and cannot be followed across days. The IP is used for that hash and for a country lookup on the server, then discarded. Details in the [privacy policy](../apps/web/src/app/privacy/page.tsx) the hosted service publishes.

Requests go as a JSON `POST`. If the browser blocks that, the script falls back to a `GET` that returns a transparent pixel.

## Custom events

Two ways.

From JavaScript:

```js
webyz.event("Signup", { plan: "growth" });
```

From markup, on any element. A click sends the event named in `data-analytics-event`, with every other `data-analytics-*` attribute as a property:

```html
<button data-analytics-event="Signup" data-analytics-plan="growth">Start free</button>
```

For links the script delays navigation just long enough to get the event out, unless the link opens in a new tab or the click carries a modifier key.

Events appear on the dashboard's Conversions card as custom events; make one a goal to count conversions and use it in funnels. Clicking an event on the dashboard filters everything to sessions that fired it and opens a Properties tab that breaks the event down by any property you sent (`Signup` by `plan`, say). Property names and values are stored as free text. Do not put personal data in them. `url`, `path`, `title`, `name`, `ref`, `lang` and `screen` are reserved payload keys and cannot be property names.

## Automatic events

Three things every site wants counted need no code beyond an attribute on the script tag.

- **Outbound links** (`data-outbound-links="true"`): a click on an `http(s)` link whose host differs from the page's sends `Outbound Link: Click` with the full destination URL as `href`. Middle clicks and modifier clicks are counted too; navigation is held just long enough to get the beacon out, as for `data-analytics-event`.
- **File downloads** (`data-file-downloads="true"`): a click on a link whose path ends in a document, archive, media or installer extension (the same list Plausible and Umami use: pdf, xlsx, docx, zip, dmg, mp4, ... ) sends `File Download` with `href`. Give `data-file-types="pdf,csv"` to track only those. A link that is both outbound and a file counts once, as a download.
- **404 pages** (`data-track-404="true"`): a script cannot see the HTTP status, so your not-found template announces itself with `<meta name="webyz-404">` in its `<head>`. The script then sends a `404` event with the missing path as `page`. Make `404` a goal and the Properties tab lists which paths are missing.

A link that already carries `data-analytics-event` sends only that event, never two.

## Single-page apps

The script wraps `history.pushState` and `replaceState` and listens to `popstate`, so route changes count as pageviews without any code. Apps that route on the URL fragment (`/#/settings`) set `data-hash-routing="true"`, which also counts `hashchange` and keeps the fragment in the recorded path. A pageview for the same URL twice in a row is ignored. To record one manually:

```js
webyz.pageview();          // current URL
webyz.pageview({ force: true }); // even if the URL has not changed
```

## Opt-out

A visitor can switch tracking off for your site from the browser console:

```js
webyz.optOut();  // stored in localStorage as "webyz-disabled"
webyz.optIn();
```

You can expose this as a button on your privacy page. The flag is the only thing the script ever writes to the browser, and only when asked.

## What is filtered

- Visitors with Do Not Track enabled, unless you set `data-respect-dnt="false"`.
- `localhost` and `file://` pages, unless `data-track-localhost="true"`.
- Headless browsers and user agents that identify as bots, crawlers, link previewers or HTTP libraries, both in the script and again on the server (the server uses the `ua-parser-js` bot database).
- Requests from known data-centre, hosting and VPN address ranges (`BOT_DATACENTER_FILTER`), because scripted browsers on rented servers send a real browser's user agent and the address is the only thing they cannot fake. The address is checked in memory and discarded, as for the geo lookup. Apple's iCloud Private Relay ranges are exempt, so iPhone users behind the relay are counted.
- Requests whose referrer is a known referrer-spam domain (`REFERRER_SPAM_LISTS`).
- Groups of traffic that behave like a browser farm: many single-pageview visits an hour sharing one screen size, browser and language, with no engagement from any of them (`BOT_CLUSTER_FILTER`). Flagged groups are dropped for 24 hours.

The dashboard shows how many requests were filtered in the selected period under the overview, split by reason on hover, so the filtering is checkable rather than taken on trust.
- Prerendered pages.

## Ingest responses

`POST /api/v1/track` answers `204` when the event was accepted. A malformed body is `400` with the failing field named, and an unknown site id is `404`, so a wrong snippet or integration is visible in the network tab. A site that has hit its plan limit gets `202` with nothing stored: a visitor's browser is not the place to surface a billing problem. The pixel `GET` always returns the image, whatever happens.

Events whose page hostname is not the site's domain, a subdomain of it, or localhost are dropped with `202` (`INGEST_HOSTNAME_CHECK`), so a site id copied from your snippet cannot be used to add traffic to your numbers. Use `data-domain` is not needed for subdomains; for one site served from unrelated domains, add each as its own site or turn the check off server-side.

Bounds: the body may be at most 16 KB; URLs 2,048 characters; titles 500; custom property values 500 characters each and at most 30 properties per event, strings, numbers or booleans only.

## Content Security Policy

If your site sets a CSP, allow the API origin in `script-src` (the script) and `connect-src` (the events):

```
script-src 'self' https://api.example.com;
connect-src 'self' https://api.example.com;
```

## Testing an install

Add `data-debug="true"`, open the console, and reload. You will see `[webyz] initialized` followed by `[webyz] sent` with the payload. On the Webyz setup screen the status flips to "first event received" within a few seconds.
