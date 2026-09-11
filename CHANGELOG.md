# Changelog

All notable changes to Webyz are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow semantic versioning. Breaking changes to the tracker script, the HTTP API or the self-hosting configuration are called out in their own subsection so operators can scan for them before upgrading.

## Unreleased

### Added

- Filter operators: every dashboard filter takes `is`, `is not`, `contains` or `does not contain` (`f.page=!~/admin` on the API), plus new `event` and `goal` filters and `screen`/`language` dimensions. Sessions now store screen size and browser language (ClickHouse migration 009); rows from before show as empty.
- Custom event properties: clicking a custom event on the dashboard filters to it and opens a Properties tab (`GET /:siteId/custom-events/properties`) listing keys and, per key, values by visitors.
- Tracker: `data-hash-routing`, `data-outbound-links`, `data-file-downloads` (`data-file-types`) and `data-track-404` (with `<meta name="webyz-404">`) send the well-known `Outbound Link: Click`, `File Download` and `404` events with no code.
- Saved segments: name a set of filters per site and apply it from the dashboard header, on shared dashboards too.
- Password-protected share links (`PUT /websites/:siteId/share/password`, `POST /shared/:slug/unlock`, `X-Share-Token`) and an embed mode for the public dashboard (`?embed=true&theme=system&background=...`) with an iframe snippet in Visibility settings.
- Team members per site: invite by email as admin or viewer, accept at `/invitations/:token` with the invited address; seats come from the owner's plan (`team_members`), pending invitations hold one; sites shared with you appear in your list with the role. Admins manage everything but deletion; viewers read everything including realtime and exports. Plan features on a site (funnels, Search Console) are judged by the site owner's plan.
- Email reports (weekly on Monday morning, monthly on the 1st, in the site's timezone) and traffic spike alerts, per site under Settings, Notifications.
- Cookieless visitor identity: a daily-rotating server-side hash replaces the one-year `_webyz` cookie. The tracker no longer writes anything to the browser except the opt-out flag.
- CSV export of every breakdown and the time series (`GET /api/v1/:siteId/export`).
- Read-only personal API keys with bearer authentication, managed at `/settings/api-keys`.
- Account self-service: JSON export of everything the account holds, change password, and account deletion that cancels billing and purges analytics.
- Health endpoints `/health` and `/health/ready`, security headers on every API response.
- One-command self-hosting: `infra/setup.sh` plus `docker compose up -d` with bundled Caddy and automatic TLS, prebuilt images on GitHub Container Registry, and a documented path for an existing reverse proxy.
- Public documentation under `docs/`, rendered on the hosted site at `/docs`.
- Email verification for password signups (`EMAIL_VERIFICATION`, on by default whenever a mail provider is configured): the account sits on Free and cannot sign in until the emailed link is opened, and the 30-day Growth trial starts at that moment, so a throwaway address gets nothing. Google signups are verified on creation. Existing accounts are treated as verified.
- `REGISTRATION` setting: the self-host stack allows only the first account and closes signups after it; `open` restores public registration.
- ClickHouse small-server profile, log rotation on every container, an unprivileged dashboard image, issue and pull request templates, Dependabot, and this changelog.

### Changed

- Tracker ingest validates every payload (16 KB body limit, bounded fields, at most 30 custom properties of 500 characters) and the quota guard fails open only when Postgres is unreachable, never on other errors.
- Client addresses are resolved under an explicit `TRUST_PROXY` setting; the API refuses to start in production without it.
- Tracker ingest accepts cross-origin requests from any site; the dashboard API keeps its allowlist.
- Plan grids no longer list team seats until a team model exists.
- A Redis outage degrades instead of stalling: the client rejects commands at once while disconnected and after 2 seconds when Redis does not answer, session checks fall through to Postgres, and the rate limiter lets requests through while its store is unreachable.
- Marketing site page weight: the handwriting font is vendored and subset to the characters the labels use (16 KB instead of the 75 KB file Google served), the stylesheet is inlined instead of render-blocking, the hero tiles load eagerly with honest `sizes`, and the below-the-fold dashboard screenshot is no longer preloaded.
- The marketing site image (`apps/web/Dockerfile`) refuses to build without `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_API_BASE_URL` as absolute origins; an image built without them published localhost URLs in its sitemap and canonical tags.

### Changed (billing provider)

- **Payments move from Stripe to Paddle Billing.** Paddle is the merchant of record: it sells to the customer, takes the payment, charges the tax and issues the invoice, so no card detail reaches the server. Stripe is removed entirely, along with its SDK, its sandbox harness and its schedule handling. Nothing had ever been sold through Stripe, so no customer or subscription was migrated.
- Checkout is Paddle's overlay, opened by the dashboard: `POST /billing/checkout` now answers with what the browser needs to open it (including the public client token) instead of a hosted URL, so one prebuilt dashboard image works for any installation.
- Overage is no longer streamed to a meter. A closed period is charged once, from the usage ledger, as a one-off subscription charge of `ceil(events / 1,000)` units at the plan's rate, keyed so a retry cannot bill twice. Paddle has no usage metering, so the arithmetic is ours.
- A plan is now one recurring price. Annual plans are a single yearly price rather than a mixed-interval subscription, and the monthly usage window inside a prepaid year is derived and rolled locally.
- Deferred downgrades no longer use a provider schedule (Paddle has none for an item change): the provider is told to bill the new price from the next renewal, entitlements stay on the paid-for plan until its period ends, and the new hourly `apply-plan-changes` job moves the plan across at that boundary.
- `GET /billing/invoices/:invoiceId/pdf` returns a fresh, short-lived PDF link per click, because the provider's links expire.
- Overage worth less than Paddle's 70c minimum transaction is waived rather than billed: the period is settled, a `WAIVED` usage record says why, and reconciliation treats it as explained. Webhook signatures are verified with a five-minute window instead of the SDK's five seconds, with a message that says whether the secret or the timestamp was at fault.
- `scripts/paddle/`: `setup.ts` provisions the catalogue and the notification destination from the plan catalog, `probe.ts` reports the account and whether the configured secret matches, `deliveries.ts` lists and replays webhook deliveries, `sync-webhook-secret.ts` writes the destination secret into `.env` without printing it, and `sandbox/` holds no-card scenarios for a subscription and an overage charge.
- New settings `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_WEBHOOK_SECRET` and `PADDLE_ENVIRONMENT`; `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_METER_EVENT_NAME` are gone. The webhook endpoint is `POST /api/v1/paddle/webhook`. `apps/api/docs/billing-runbook.md` is rewritten for Paddle, including the payment-recovery setting that must never cancel a subscription over a failed usage charge.

### Changed (beta pricing)

- `GET /plans` reports per plan whether it can be bought (provider configured and a price id present) plus the trial on offer. The pricing page and the billing page read that instead of offering a checkout that would fail: during the beta they say paid plans are not on sale, that new accounts get the 30-day Growth trial then the free plan, and that prices are provisional. Both become normal purchase flows the moment the payment provider and price ids exist.

### Fixed

- A free plan's period rollover now lifts the quota pause immediately instead of waiting up to an hour for the enforcement job.
- Dashboard: API failures render as failures with a retry instead of "no traffic yet" or "site not found"; a render error shows a message with a reload instead of a blank page; an expired session goes straight to the login page; the paused banner names the real reason (event limit, spending cap, payment, trial end, inactive site).
- Timezone pickers list every IANA zone the browser knows.
- Rate limits are counted in Redis, so they hold across API instances.
- Request logs record the route pattern, status and duration, never the visitor's page URL, address or the OAuth code, and credentials are redacted.
- Production without a mail provider no longer prints password-reset and confirmation links into the log.
- Search Console refresh tokens are encrypted at rest (`ENCRYPTION_KEY`).
- Events from a page on another domain than the site's are dropped (`INGEST_HOSTNAME_CHECK`).
- Marketing site: Open Graph and Twitter tags, canonical URLs, `robots.txt` and `sitemap.xml`; stock placeholder assets removed. Dashboard bundle split into cacheable vendor chunks.

- Billing page: the plan a trial runs on can be subscribed to during the trial (it was shown as "Current plan" and disabled), and the usage summary no longer describes a trial or free account as pay-as-you-go; overage is billable only when a provider subscription exists, the rule enforcement already used.
- The geo database now downloads after `MAXMIND_LICENSE_KEY` is added: a weekly `update-geo` run that skipped for lack of a key used to hold its lock for six days, so the key had no effect until then. The updater also keeps the existing database when a download fails instead of deleting it first.
- Framework-level client errors (body too large, invalid JSON, unsupported media type) are reported with their own 4xx status and code instead of a generic 500.
- Event time is the server's receive time. The client-supplied `ts` used to be written verbatim, which let a wrong clock or a hostile request place events in a closed billing period, past the retention cut or years into the future; it is still accepted and now ignored, and the tracker no longer sends it. The unused ClickHouse `websites` table is dropped (migration 008).

### Breaking

- Stripe settings are removed. An installation that set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` or `STRIPE_METER_EVENT_NAME` must replace them with the `PADDLE_*` settings, and point a Paddle notification destination at `/api/v1/paddle/webhook`; `/api/v1/stripe/webhook` no longer exists. Billing columns are renamed to provider-neutral names (`provider_customer_id`, `provider_subscription_id`, `provider_price_monthly_id`, `provider_price_yearly_id`) and the Stripe-only ones are dropped, by migration. `POST /billing/checkout` no longer returns `{ url }`.
- `TRUST_PROXY` is required in production.
- Old tracker payload fields `vid`, `ssid`, `new_session` and `new_visitor` are accepted but ignored; identity is server-derived.
