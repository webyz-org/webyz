# HTTP API

Everything the dashboard shows is available over HTTP. The base URL is your API origin plus `/api/v1`, for example `https://api.example.com/api/v1`. All responses are JSON unless stated.

## Authentication

Two ways, same endpoints.

**API key** (for scripts and integrations). Create one under Account menu → API keys in the dashboard; it is shown once. Send it as a bearer token:

```bash
curl -H "Authorization: Bearer wbz_..." https://api.example.com/api/v1/websites
```

API keys are **read-only**: any request other than `GET` or `HEAD` is refused with `403 API_KEY_READ_ONLY`. They require the account's plan to include API access; on a self-hosted install that is the Growth and Business plans as seeded (see [self-hosting.md](self-hosting.md), "Plans on a self-hosted install"). A key reads exactly what its owner can see and nothing more.

**Session cookie** (what the dashboard uses). `POST /users/auth/login` sets a `webyz_session` cookie; send it back with `credentials: include`. Cookie requests are subject to the CORS allowlist (`FRONTEND_URL`, `MARKETING_URL`, `CORS_ORIGINS`).

Public dashboards: a site the owner has shared is readable without either credential by anyone who knows its id, on the read endpoints marked "owner or public" below.

## Response envelope

Success:

```json
{ "success": true, "data": ..., "meta": { "requestId": "req-1", "page": 1, "limit": 10, "total_items": 42, "has_more": true, "retention": { ... } } }
```

`meta` carries pagination where the endpoint pages, and `retention` when the requested window was cut to what the plan keeps.

Failure:

```json
{ "success": false, "error": { "code": "SITE_ACCESS_DENIED", "message": "You do not have access to this site" } }
```

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `BAD_REQUEST`, `INVALID_PERIOD`, `VALIDATION_ERROR`, `IMPORT_EMPTY_RANGE` | A parameter is missing or malformed; the message says which |
| 401 | `UNAUTHORIZED` | No credential, an expired session, or an unknown or revoked key |
| 403 | `FORBIDDEN`, `SITE_ACCESS_DENIED`, `API_KEY_READ_ONLY`, `FEATURE_NOT_AVAILABLE`, `EMAIL_NOT_VERIFIED`, `REGISTRATION_DISABLED` | Not allowed; `FEATURE_NOT_AVAILABLE` names the feature and plan |
| 404 | `NOT_FOUND`, `IMPORT_NOT_FOUND`, `IMPORT_PROPERTY_NOT_FOUND`, `EXPORT_NOT_FOUND`, `EXPORT_EMPTY` | Unknown site, goal, funnel, key, import, GA4 property or export; `EXPORT_EMPTY` when a site has nothing tracked to export |
| 409 | `CONFLICT`, `TOO_MANY_API_KEYS`, `IMPORT_LIMIT`, `IMPORT_OVERLAP`, `IMPORT_NOT_CONNECTED`, `IMPORT_REAUTH_REQUIRED` | Duplicate or limit reached; an import that clashes with an existing one, or needs a Google connection first |
| 413 | | Request body too large. CSV import chunks are capped at 1,000,000 characters by the API and at 2 MB by the bundled proxy |
| 429 | | Rate limited; see below |
| 501 | `IMPORT_NOT_CONFIGURED` | Google Analytics import is off on this install (no Google OAuth client) |
| 5xx | `INTERNAL_SERVER_ERROR` | Ours, with a `requestId` in the logs |

## Rate limits

300 requests a minute per client address across the API. Credential endpoints (signup, login, password reset, account deletion) allow 10 a minute. Event ingest and health checks are not limited. Limits are reported in `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`.

## Periods, dates and filters

Every analytics endpoint takes the same time parameters, resolved in the **site's own timezone**:

| Parameter | Values |
| --- | --- |
| `period` | `today`, `yesterday`, `last_7_days`, `last_28_days`, `last_91_days`, `this_month`, `last_month`, `this_year`, `last_12_months`, `all_time`, `custom` |
| `date` | `YYYY-MM-DD`, shifts `today`, `yesterday`, `this_month` and friends to be relative to that day |
| `from`, `to` | `YYYY-MM-DD`, required with `period=custom`; `to` is inclusive |

Drill-down filters are `f.<key>` parameters whose values are the labels the dashboard shows, so `f.browser=Chrome`, `f.country=DE`, `f.channel=Organic Search`, `f.page=/pricing`. Keys: `page`, `entry_page`, `exit_page`, `title` (sessions that viewed a page with that title), `search_term` (sessions that searched the site for that term), `hostname` (the host the visit started on), `event` (sessions that fired the custom event), `goal` (a goal's name, resolved to its event or page), `outbound_domain` and `outbound_url` (sessions that clicked an outbound link to that host, without a leading `www.`, or to that exact URL), `download` (sessions that downloaded that file URL; `~.pdf` for a type), `browser`, `browser_version`, `os`, `os_version`, `device`, `screen`, `language`, `channel`, `source`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `country`, `region`, `city`. Unknown keys are ignored. Channel values are `Direct`, `Organic Search`, `Organic Social`, `Paid Search`, `Paid Social`, `Display`, `Email`, `Affiliates`, `AI Assistants`, `Referral` and `Other Campaign`. `AI Assistants` is a visit referred by, or tagged with the `utm_source` of, a known assistant (ChatGPT, Perplexity, Claude, Gemini, Copilot and others); sessions recorded before that channel existed are regrouped into it when read.

A value is an exact match unless it starts with an operator prefix: `!` is not (`f.browser=!Chrome`), `~` contains (`f.page=~/blog`), `!~` does not contain (`f.page=!~/admin`). Substring matches ignore case. A literal value that itself begins with `!`, `~` or `=` is written with a `=` right after the operator marker (`f.page==!weird`, `f.page=!=~weird`). For `page`, `title`, `search_term`, `event`, the outbound keys and `download`, a negative operator means sessions that never viewed a matching page, fired a matching event, clicked out to a matching destination or downloaded a matching file. One condition per key.

Paged endpoints take `limit` (1 to 100, default 10) and `page` (default 1).

### Imported data

When a site has imported history from Google Analytics 4 or CSV files (the imports routes under Websites; the [importing guide](importing.md) covers what comes across), `top-stats`, `main-graph`, every breakdown, `pages`, `pages/detail`, `conversions`, `custom-events`, the three `outbound-links` endpoints and `export` add the imported daily totals for the days in the period that fall inside the import. Imported days never overlap tracked days, so the numbers add.

Imported rows are kept per report family, with the attributes the source reported together: channel, source and UTM fields; page and hostname; country, region and city; browser and version; OS and version; event and link URL; and one family each for entry pages, exit pages, devices, screen sizes, languages, page titles and site search. A request keeps imported days when its breakdown and all its filters belong to one family (`f.source=google.com` on `utm-campaign`, `f.country=IN` on `regions` or on `top-stats`); when they span two families imported days are left out of that response. `meta.imported` says which: `"included"`, `"excluded_filters"`, or `"off"` with `with_imported=false`. No `imported` key means no imported day is in the period. Hostname can filter imported pages but not group them, and the outbound links `page` grouping has no imported data (neither source reports it).

Imported page and event rows add visitors, visits and views but no bounces or visit seconds, so bounce rate and visit duration divide only by the visits that carry them. `main-graph` at `hour` or `minute` intervals has nothing to place imported days in. Visitors over a multi-day range sum daily visitors, so someone who visited on two imported days counts twice. GA4 counts a bounce as a session that was not engaged, which is close to but not the same as a Webyz bounce.

## Endpoints

### Websites

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /websites` | any | Your sites and sites shared with you, each with `role` (`owner`, `admin`, `viewer`) and `hasPassword` |
| `POST /websites` | owner, cookie only | Create `{ name, domain, timezone? }` |
| `GET /websites/:siteId` | owner or member | One site, with `role` |
| `PATCH /websites/:siteId` | owner or admin, cookie only | Update `name`, `domain`, `timezone` |
| `DELETE /websites/:siteId` | owner, cookie only | Delete the site and all of its analytics |
| `GET /websites/:siteId/install-status` | owner or member | `{ hasEvents }`, whether anything has ever arrived |
| `POST` / `DELETE /websites/:siteId/share` | owner or admin, cookie only | Turn the public dashboard on (mints a slug) or off. Turning it off also clears the password. Responses carry `isPublic`, `publicSlug`, `shareUrl`, `hasPassword` |
| `PUT` / `DELETE /websites/:siteId/share/password` | owner or admin, cookie only | Set `{ password }` (8 to 128 characters) in front of the share link, or remove it. Setting a new one invalidates every token already issued |
| `GET /shared/:slug` | public | Resolve a share slug to the site: `{ id, name, domain, timezone, hasPassword }` |
| `POST /shared/:slug/unlock` | public | `{ password }`; answers `{ token, expiresIn }`. Send the token as `X-Share-Token` on every analytics read of that site; without a valid one they answer 401 `SHARE_PASSWORD_REQUIRED`, a wrong password is 401 `SHARE_PASSWORD_INVALID` |
| `GET /websites/:siteId/segments` | owner or member | Saved segments, by name: `{ id, websiteId, name, filters, createdAt, updatedAt }`. `filters` is the same wire form the `f.*` parameters take (`{ "browser": "Chrome", "page": "!~/admin" }`) |
| `POST /websites/:siteId/segments` | owner or admin, cookie only | `{ name, filters }`; 201. Name 1 to 80 characters, unique per site (409 `CONFLICT`); 1 to 10 filter keys from the filter list plus `goal`, each value at most 1000 characters with an optional operator prefix; at most 50 segments per site |
| `PATCH` / `DELETE /websites/:siteId/segments/:segmentId` | owner or admin, cookie only | `{ name?, filters? }` (at least one), or delete |
| `GET /shared/:slug/segments` | public | Segments of a shared dashboard, read-only; needs `X-Share-Token` when the share has a password |
| `GET /websites/:siteId/notifications` | owner or member | `{ reports: [{ id, frequency, recipients, lastPeriodEnd, ... }], alert: { id, threshold, recipients, lastTriggeredAt, ... } \| null }` |
| `PUT` / `DELETE /websites/:siteId/notifications/reports/:frequency` | owner or admin, cookie only | `:frequency` is `weekly` or `monthly`; `{ recipients }` (1 to 10 addresses). Weekly covers the last Monday to Sunday and goes out after Monday 09:00 in the site's timezone; monthly covers the previous month and goes out after the 1st 09:00 |
| `POST /websites/:siteId/notifications/reports/:frequency/test` | owner or member, cookie only | Send the latest completed period to the caller's own address now |
| `PUT` / `DELETE /websites/:siteId/notifications/alert` | owner or admin, cookie only | `{ threshold (1 to 1,000,000), recipients }`: one email when live visitors reach the threshold, then nothing for 12 hours |
| `GET /websites/:siteId/members` | owner or member | `{ role, owner, members, invitations, seats }`: who has access and the caller's own role |
| `POST /websites/:siteId/members/invitations` | owner or admin, cookie only | `{ email, role }` with role `ADMIN` or `VIEWER`; emails a link valid for 7 days. 403 `TEAM_SEATS_EXHAUSTED` when the owner's plan has no seat left (pending invitations hold one) |
| `DELETE /websites/:siteId/members/invitations/:invitationId` | owner or admin, cookie only | Withdraw an invitation |
| `PATCH /websites/:siteId/members/:memberId` | owner or admin, cookie only | `{ role }` |
| `DELETE /websites/:siteId/members/:memberId` | owner, admin, or the member themself | Remove, or leave |
| `GET /invitations/:token` | public | What an invitation is for: `{ email, role, site, invitedBy, expiresAt, expired }` |
| `POST /invitations/:token/accept` | cookie | Join the site. The signed-in account's email must be the invited one (403 `INVITATION_EMAIL_MISMATCH`); an expired link is 410 `INVITATION_EXPIRED` |
| `GET` / `POST /websites/:siteId/goals`, `DELETE .../goals/:goalId` | owner or admin | Goals: `{ name, eventName? }` or `{ name, pagePath? }` |
| `GET /websites/:siteId/goals/:goalId/detail` | owner or member | Breakdown of sessions that converted |
| `GET` / `POST /websites/:siteId/funnels`, `PATCH` / `DELETE .../funnels/:funnelId` | owner or admin (reads: any member) | Funnels of 2 to 8 ordered steps; the site owner's plan must include funnels |
| `GET /websites/:siteId/funnels/:funnelId/analysis` | owner or member | Per-step counts and drop-off for the period |
| `GET /websites/:siteId/imports` | owner or admin | Imports of this site's history, up to 5: `{ id, source (`ga4`, `csv`), property_id, property_name, start_date, end_date, status (pending, running, completed, failed), steps_done, steps_total, rows_imported, skipped, not_imported, error, created_at, completed_at }` |
| `GET /websites/:siteId/imports/ga4/auth-url` | owner or admin | `{ url }` to send the browser to for Google consent (read-only Analytics access). Google returns to `GET /imports/ga4/callback` (no login; a redirect back to the site's import settings). 501 `IMPORT_NOT_CONFIGURED` when the install has no Google OAuth client |
| `GET` / `DELETE /websites/:siteId/imports/ga4/connection` | owner or admin (DELETE: cookie only) | The connected Google account and its GA4 properties `{ configured, connected, email, properties: [{ id, name, account }] }`, or forget the connection. A connection lasts an hour if no import is started; 409 `IMPORT_REAUTH_REQUIRED` once it has lapsed |
| `POST /websites/:siteId/imports` | owner or admin, cookie only | `{ propertyId, startDate?, endDate? }`; 201 with the queued import. The range is clipped to the property's creation date and to the day before the site's first tracked visit (400 `IMPORT_EMPTY_RANGE` when nothing is left). A site holds up to 5 imports (409 `IMPORT_LIMIT`) whose dates may not overlap (409 `IMPORT_OVERLAP`, with the conflicting import's range in `details`); 409 `IMPORT_NOT_CONNECTED` without a connection, 409 `IMPORT_REAUTH_REQUIRED` when it has lapsed, 404 `IMPORT_PROPERTY_NOT_FOUND` when the connected account cannot see `propertyId`, 501 `IMPORT_NOT_CONFIGURED` on an install without Google |
| `POST /websites/:siteId/imports/csv` | owner or admin, cookie only | Start a CSV import in Plausible's format (a Plausible export, or any tool's files; layout in the [importing guide](importing.md#csv-format)): `{ files, name?, chunks }` where `files` are up to 20 CSV names (`imported_visitors_20240101_20241231.csv`, ...; `imported_visitors` is required) and `chunks` the number of uploads to expect (for progress). 201 with the import, `source: csv`, `status: running`. The range comes from the file names, clipped as for GA4, with the same limit and overlap rules |
| `PUT /websites/:siteId/imports/:importId/chunks?file=&index=` | owner or admin, cookie only | One piece of one CSV as a raw `text/csv` body of at most 1,000,000 characters (the dashboard sends 240,000; a proxy in front may cap lower), starting with the file's header row and ending on a whole row. 404 `IMPORT_NOT_FOUND` for an unknown import, 400 once it is no longer running. This route allows 3,000 requests a minute. A chunk already received (same `file` and `index`) is acknowledged with `duplicate: true` and not written again. Answers `{ rows, duplicate }` |
| `POST /websites/:siteId/imports/:importId/complete` | owner or admin, cookie only | Finish the upload; the data appears on the dashboard. 404 `IMPORT_NOT_FOUND`; 400 while `imported_visitors` has not been uploaded. An upload with no chunk for an hour fails and its rows are removed |
| `GET /websites/:siteId/exports` | owner or admin | The site's current export (`id`, `filename`, `status` running, completed or failed, `size_bytes`, `error`, `created_at`, `completed_at`, `expires_at`), or `null` |
| `POST /websites/:siteId/exports` | owner or admin, cookie only | Prepares the site's tracked history as a zip of CSVs in the import format ([importing guide](importing.md#export)), named `<domain with _ for .>_<YYYYMMDD>.zip`, in the background; 202 with the running export, which replaces any earlier one. Any plan; cut to the plan's retention. 404 `EXPORT_EMPTY` when nothing has been tracked |
| `GET /websites/:siteId/exports/:exportId/download` | owner or admin | The prepared zip, for seven days after it completes. 404 `EXPORT_NOT_FOUND` when it is unknown, unfinished or expired |
| `DELETE /websites/:siteId/exports/:exportId` | owner or admin, cookie only | Deletes the export and its file; `{ deleted: true }`, 404 `EXPORT_NOT_FOUND` |
| `DELETE /websites/:siteId/imports/:importId` | owner or admin, cookie only | Delete the import and its data, stopping it if it is still running. Tracked data is untouched. `{ deleted: true }`, 404 `IMPORT_NOT_FOUND` |

### Analytics

All under `/:siteId/`. Readable by the owner, any team member, or anyone when the dashboard is shared (with a valid `X-Share-Token` header if the share has a password, see Websites), unless marked.

| Path | Extra parameters | Returns |
| --- | --- | --- |
| `top-stats` | filters | Visitors, visits, pageviews, views per visit, bounce rate, visit duration, each with the previous period's value. Visit duration runs from the first pageview to the last pageview, custom event or engagement report, so single-page visits count the time the page was visible. A bounce is a visit with one pageview and no custom event, as in Plausible and Umami |
| `filtered-traffic` | | owner or member only: requests the bot filters refused in the period, `{ total, reasons: { bot_user_agent, datacenter_ip, referrer_spam, scripted_cluster } }` |
| `main-graph` | `metric` (`visitors`, `visits`, `pageviews`, `views_per_visit`, `bounce_rate`, `visit_duration`), `interval` (`minute`, `hour`, `day`, `week`, `month`; widened automatically for long ranges), filters | `labels` and `plot` arrays |
| `top-pages`, `entries`, `exits` | `detailed=true`, `limit`, `page`, filters | Breakdown rows: `name`, `visitors`, `percentage`, and with `detailed` also `visits`, `pageviews`, `bounce_rate`, `visit_duration` |
| `titles`, `hostnames` | same | Pages grouped by the title the page had, and visits grouped by the host they started on |
| `search-terms` | same | Site search terms read from page URLs (the first non-empty of `q`, `s`, `search`, `query`, `keyword`, `keywords`, `term`). `pageviews` (and `visits`) is the number of searches; bounce rate and duration do not apply and are 0 |
| `browsers`, `browser-versions`, `os`, `os-versions`, `device-types`, `screen-sizes`, `languages` | same | Technology breakdowns (screen as `WxH`, language as a BCP 47 tag; both empty for sessions recorded before the columns existed). Versions are labelled major.minor (`Chrome 128.0`, `macOS 10.15`) for tracked and imported data alike; a `browser_version` or `os_version` filter with a longer version (`Chrome 128.0.0.0`) matches the same row |
| `channel`, `source`, `utm-source`, `utm-medium`, `utm-campaign`, `utm-content`, `utm-term` | same | Acquisition breakdowns |
| `countries`, `regions`, `cities` | same | Geography breakdowns (country as ISO code) |
| `pages` | `search`, `sort` (`views`, `sessions`, `visitors`, `bounce_rate`, `duration`, `scroll_depth`, `time_on_page`, `trend`), `order` (`asc`, `desc`), `limit`, `page` | The pages table. Each row carries `scroll_depth` (the average of each visit's deepest scroll on the page, percent) and `time_on_page` (engaged seconds per visit that reported engagement), both `null` when no visit reported engagement for the page |
| `pages/detail` | `path` (required) | One page's numbers and trend, with `scroll_depth` and `time_on_page` as in `pages` |
| `realtime` | | Current visitors and the last 30 minutes |
| `realtime/visitors` | `window` (`5`, `15`, `30` minutes) | owner or member only: per-visitor rows |
| `realtime/visitors/:visitorId/activity` | `window` | owner or member only: one visitor's recent events |
| `realtime/stream` | | owner or member only: server-sent events of new activity |
| `conversions` | filters | Goal conversions for the period |
| `custom-events` | filters | Custom event names with counts |
| `custom-events/properties` | `event` (required), `key`, `limit`, filters | Without `key`: the property keys the event carried, each with `visitors`, `events`, `percentage` of the event's visitors. With `key`: that property's values |
| `outbound-links/summary` | `kind`, filters | Totals for the period with the preceding window under `previous`: `clicks`, `visitors`, `destinations` (distinct hosts), `urls` (distinct URLs, the files for downloads), `pages`, `clicks_per_visitor`, `click_rate` (visitors who clicked over all visitors, percent), `site_visitors` |
| `outbound-links/timeseries` | `kind`, `interval` (`hour`, `day`, `week`, `month`; widened automatically), filters | `labels`, `clicks` and `visitors` arrays, one entry per bucket |
| `outbound-links` | `kind` (`outbound` default, `download`), `by` (`domain` default, `url`, `page`, `type`), `limit`, `page`, filters | Link clicks grouped by destination host without `www.`, by full destination URL, by the page clicked from, or by the destination's file extension. `kind=outbound` reads the tracker's `Outbound Link: Click` event, `kind=download` its `File Download` event (see the tracker guide). Rows: `name`, `visitors`, `clicks`, `percentage` (of visitors who clicked), `conversion_rate` (of all visitors, the click-through or download rate). Meta: `kind`, `total_visitors`, `total_clicks`, `site_visitors`, `total_items`, `has_more`. An `outbound_domain` or `outbound_url` filter also narrows the outbound rows themselves to that destination's clicks, and a `download` filter the download rows to that file |
| `journeys` | `metric` (`users`, `sessions`), `depth`, `startingPath`, filters | Path transitions between pages; needs the Journeys entitlement |
| `export` | `dataset`, period, filters | **CSV**, owner or member only; see below |

### Export

`GET /:siteId/export?dataset=<name>&period=...` returns `text/csv` as an attachment, up to 10,000 rows. `dataset` is `timeseries` (one row per day, or per hour for windows of two days or less, with all six metrics), any breakdown path above (`browsers`, `countries`, `top-pages`, `titles`, `search-terms`, `hostnames`, ...), or the link reports as `outbound-domains`, `outbound-links`, `outbound-pages`, `download-files`, `download-types` or `download-pages`. Filters and imported data apply as on the dashboard. Requires the Exports entitlement.

```bash
curl -H "Authorization: Bearer $WEBYZ_KEY" -o browsers.csv \
  "https://api.example.com/api/v1/SITE_ID/export?period=last_28_days&dataset=browsers"
```

Cells are RFC 4180 escaped and values that begin with `=`, `+`, `-` or `@` are prefixed with a quote so spreadsheets do not treat visitor-supplied text as formulas.

### Account

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /users/auth/providers` | public | Which sign-in methods are configured, e.g. `{ "google": true }` |
| `POST /users/auth/signup` | public | `{ name, email, password }`. Returns `requiresVerification`; when true no cookie is set until the emailed link is opened |
| `POST /users/auth/verify-email` | public | `{ token }` from the confirmation email; signs the user in and starts the trial |
| `POST /users/auth/verify-email/resend` | public | `{ email }`; always 200 |
| `POST /users/auth/login` | public | `{ email, password }` |
| `POST /users/auth/logout` | cookie | End this session |
| `GET /users/auth/me` | any | The current user |
| `GET /users/auth/sessions`, `DELETE .../sessions/:sessionId` | cookie | List and revoke sign-ins |
| `POST /users/auth/password` | cookie | `{ currentPassword, newPassword }`; logs out other devices |
| `POST /users/auth/password/forgot`, `.../password/reset` | public | Email a reset link; redeem it with `{ token, newPassword }` |
| `GET /users/auth/google`, `.../google/callback` | public | Google sign-in, when configured |
| `GET /users/me/export` | any | Everything the account holds, as a JSON attachment |
| `DELETE /users/me` | cookie | `{ password }` for password accounts. Cancels billing, deletes the account, its sites and all analytics |
| `GET` / `POST /api-keys`, `DELETE /api-keys/:keyId` | cookie | Manage API keys; the token appears only in the `POST` response |

### Plans and billing

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /plans` | public | The plan catalogue with prices, limits, entitlements and a per-plan `purchasable` flag; `meta.billing` says whether anything is for sale and what the trial is |
| `GET /billing/usage` | any | Current plan, access state, usage this period, entitlements |
| `GET /billing/invoices` | any | Invoices from the payment provider, newest first |
| `GET /billing/invoices/:invoiceId/pdf` | cookie | A fresh, short-lived link to one invoice's PDF; `404` while the provider has none |
| `POST /billing/checkout` | cookie | Answers with what the browser needs to open the provider's checkout, not a URL: `{ kind: "overlay", clientToken, environment, priceId, quantity, customerId, customData, successUrl }`. Only meaningful when the payment provider is configured |
| `GET /billing/checkout-config` | cookie | The provider script's public configuration (`{ config: { provider, clientToken, environment } }`, or `config: null` when billing is off). The billing page uses it to open a payment the provider sent the customer to finish (`?_ptxn=` on the billing page) |
| `GET /billing/portal`, `POST /billing/change-plan`, `/billing/cancel`, `/billing/resume`, ... | cookie | Subscription management; only meaningful when the payment provider is configured |
| `POST /paddle/webhook` | signature | The payment provider's notification destination. Verified against `PADDLE_WEBHOOK_SECRET` over the raw body; never call it yourself |

### Ingest

| Method and path | Purpose |
| --- | --- |
| `POST /track` | The tracker's endpoint. JSON body; `204` on success, `404` for an unknown site, `202` when the site is paused |
| `GET /track` | Same payload as query parameters; always returns a 1×1 GIF |

The payload is documented in [tracker.md](tracker.md). Sending events from your own code is supported: the minimum is `{ "t": "pageview", "sid": "<site id>", "url": "https://..." }`; custom events use `"t": "event"` with `"name"`. Visitor and session identity are derived on the server, and so is the event time (when the API received it); nothing you send is used for either, and a `ts` field from older scripts is accepted and ignored.

### Health

`GET /health` (liveness, always `200`) and `GET /health/ready` (Postgres, ClickHouse and Redis each pinged, `503` if any fails), also available under `/api/health`.

## Examples

Headline numbers for the last 28 days, restricted to visitors on Chrome:

```bash
curl -H "Authorization: Bearer $WEBYZ_KEY" \
  "https://api.example.com/api/v1/$SITE/top-stats?period=last_28_days&f.browser=Chrome"
```

Daily visitors for a custom range:

```bash
curl -H "Authorization: Bearer $WEBYZ_KEY" \
  "https://api.example.com/api/v1/$SITE/main-graph?period=custom&from=2026-08-01&to=2026-08-31&metric=visitors&interval=day"
```

Top 100 countries with bounce rate and duration:

```bash
curl -H "Authorization: Bearer $WEBYZ_KEY" \
  "https://api.example.com/api/v1/$SITE/countries?period=this_month&detailed=true&limit=100"
```

## Stability

The API is versioned in the path (`/v1`). During the beta, additive changes (new fields, new endpoints) ship without notice; removals or renames are announced in release notes first. Field names in breakdown rows match the ClickHouse column vocabulary and are considered stable.
