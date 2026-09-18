# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Webyz is a self-hosted web analytics product (Plausible/Umami shaped). A JS tracker on a customer site posts events to a Fastify API, which writes them to ClickHouse. Postgres (via Prisma) holds accounts, websites, plans, subscriptions and usage; ClickHouse holds the event and session firehose plus aggregates.

## Monorepo layout

pnpm workspaces + Turborepo. Node >= 22, pnpm 10.

| Path | Name in package.json | What it is | Dev port |
| --- | --- | --- | --- |
| `apps/api` | `backend` | Fastify 5 API, tracker ingest, ClickHouse queries, Prisma, cron jobs | 3042 |
| `apps/app` | `app` | Vite + React 19 dashboard (SPA), TanStack Query, shadcn/Tailwind 4 | 3041 |
| `apps/web` | `my-app` | Next.js 16 marketing site + auth pages | 3040 |
| `examples/tracker` | - | static HTML pages that load the tracker for manual testing | - |

All four apps are members of the single root pnpm workspace. `apps/web` used to carry its own `pnpm-workspace.yaml` and lockfile, which made it a competing workspace root; both are gone, so install from the repo root.

`onlyBuiltDependencies` in the root `pnpm-workspace.yaml` allows `sharp` and `unrs-resolver` to run install scripts. Without it pnpm fails the install with `ERR_PNPM_IGNORED_BUILDS`.

## Commands

Root (Turborepo fans out to every workspace that defines the script):

```bash
pnpm dev            # all apps
pnpm build
pnpm lint           # all three apps
pnpm typecheck      # apps/api
pnpm format:check   # no workspace defines this yet, still a no-op
```

Per app, run from the app directory:

```bash
# apps/api
pnpm dev                        # tsx watch src/server.ts
pnpm build                      # clears dist, then tsc -p tsconfig.build.json
pnpm start:prod
pnpm prisma:generate            # regenerates into src/generated/prisma
pnpm prisma:migrate             # prisma migrate dev
pnpm clickhouse:migrate         # applies clickhouse/migrations/*.sql in filename order
pnpm clickhouse:seed
pnpm prisma:seed                # seeds the Free/Growth/Business plans
pnpm typecheck

# apps/app
pnpm dev / pnpm build / pnpm lint

# apps/web
pnpm dev / pnpm build / pnpm lint
```

Local infrastructure:

```bash
docker compose up -d            # postgres 5442, clickhouse 8123/9010, redis 6382
```

Host ports are deliberately non-default because 5432, 6379 and 9000 are commonly taken by other projects; keep `apps/api/.env` in sync with them (see `apps/api/.env.example`).

Ingest writes to ClickHouse inline in the request; there is no queue. A Kafka path existed and was removed as dead code: a hard-coded constant kept it off and nothing shipped it.

Tests use Node's built-in runner, no framework dependency: `pnpm test` in
`apps/api` runs `node --import tsx --test "src/**/*.test.ts"`. Tests sit next to
the code as `*.test.ts` and are excluded from the build. Billing and usage
enforcement (money-path) code must have tests; other areas are untested, so do
not claim a change there is tested. Pure logic is tested directly; database
paths are tested against the Postgres in `DATABASE_URL` when `RUN_DB_TESTS=1`
is set, and skipped otherwise.

A `*.db.test.ts` must not import a module that opens a process-wide connection
(`lib/redis.ts`, `lib/clickhouse.ts`, or anything importing them, such as
`billing-cron.service.ts`). The handle keeps the event loop alive, so the test
file never exits and `node --test` kills it after the timeout, reporting a
failure while every subtest passed. Put the code under test in a module that
takes its dependencies as arguments, which is the convention everywhere else in
`core/`.

Tests never send real email. `core/email/transports.ts` forces the console
transport whenever `NODE_TEST_CONTEXT` is set (Node sets it in every process
the test runner spawns), and the `test` script blanks `RESEND_API_KEY` as well.
Without that guard a DB run sends dozens of messages through whatever key sits
in the developer's `.env`, exhausts the provider's rate limit, and then fails
unrelated tests: `notifyOnce` deletes its row and reports failure when delivery
fails, so assertions about notifications break for a reason that has nothing to
do with the code under test.

## State of the codebase

Everything below builds and runs. `pnpm lint`, `pnpm typecheck` and `pnpm build`
are all green at the repo root, and the compiled API (`node dist/server.js`)
boots and serves.

Verified working end to end against live Postgres, ClickHouse and Redis: signup
and login, tracker ingest, all breakdowns, the timezone-aware graph, realtime,
goals and conversions, public share links, per-site settings, and the usage
sync plus quota enforcement chain in both directions (block and unblock).

Two things are deliberately unfinished, and both need a decision rather than
code:

- **Pricing is final; live purchases open when Paddle verification passes.**
  `catalog/plans.config.ts` carries the approved prices (9 Sep 2026) and
  `BILLING_CONFIG.pricingFinal` is true, so `GET /plans` reports
  `pricing.status: "final"`. A plan is `purchasable` only when the provider is
  configured and its row carries price ids; until then the marketing pricing
  page and the in-app billing page say paid plans are not on sale yet and
  describe the trial. On the hosted stack `REGISTRATION` has been `open` since
  9 Sep 2026 (Paddle's domain review read a closed signup as a login wall);
  purchases still wait on Paddle's verification and domain approval, which
  Paddle itself enforces.
- **Paddle has run live once, end to end, on 10 Sep 2026** (runbook 9a): a
  real overlay checkout on app.webyz.io with a one-use 100% discount (Starter
  monthly, $0 total, real card), `transaction.paid/completed` and
  `subscription.created/activated` delivered and processed, local Starter row
  with the invoice recorded; a provider-side item change to Growth with
  `do_not_bill` synced by `subscription.updated`; a scheduled cancel kept the
  row active with `cancelAt`; an immediate cancel left it CANCELED with a Free
  row backfilled at once and the site unblocked; the discount archived. Not yet
  exercised live: a non-zero payment, overage charging, payment recovery.
- **Paddle sandbox coverage.** Verified against the sandbox
  on 9 Sep 2026: customer creation, the overlay checkout handle, the customer
  portal, signed webhooks (accept, duplicate, reject), a subscription created
  from an invoice-collected transaction with the local row and periods to
  match, a real overage charge with its idempotency scan, and the waiver of
  sub-minimum overage. Not yet exercised: a real payment (the API cannot mark
  a transaction paid), plan changes, cancel and resume, and payment recovery
  (live only). `apps/api/docs/billing-runbook.md` sections 9 and 10 record
  what was seen and what remains. `scripts/paddle/` holds the provisioning,
  probe, deliveries and sandbox scenario scripts.

`npx tsx scripts/paddle/setup.ts` (in `apps/api`) provisions the provider
catalogue from the plan catalog, idempotently: one product and two prices per
paid plan, tagged `custom_data.webyz_plan`/`webyz_cycle`, with the ids written
onto the `plans` rows, plus the notification destination with
`--webhook <url>`. It refuses a live key without `ALLOW_LIVE=1` and refuses
live prices while `pricingFinal` is false. `scripts/paddle/probe.ts` reports
what the account holds, whether the `plans` rows point at prices that exist in
it, and which events the destination carries. Neither prints a secret.

`npx tsx scripts/billing/reconcile.ts` (in `apps/api`) is the read-only
reconciliation of ledger, charging checkpoint, charge transaction and invoice
line for closed periods; it exits non-zero on any finding. The billing page (`apps/app` BillingPage) renders
only from `GET /billing/usage`, `/plans` and `/billing/invoices`; it computes
nothing itself.

`apps/api/docs/billing-runbook.md` is the production checklist for Paddle:
the Retain payment-recovery setting (never cancel on a failed usage charge,
and there is no API for it), price provisioning, the notification event list,
India-seller facts, jobs, overage charging, monitoring queries, reconciliation
steps, the Paddle behaviours the code depends on, and what to exercise in the
sandbox. There is no sandbox harness in the repo.

Billing lives under `apps/api/src/core/billing/`, one folder per concern:
`catalog` (the only place plan numbers, thresholds, trial and spend-cap
settings are written; seeded into `plans`), `entitlements`, `state` (access
derivation), `usage` (billable definition, hourly buckets, period rollover),
`reporting` (one overage charge per closed period, checkpointed in
`reportedEvents`), `subscription` (provider-agnostic lifecycle and period
derivation), `provider` (the `BillingProvider` interface, the Paddle
implementation, a fake for tests; the only place the Paddle SDK is imported),
`webhooks` (idempotent ingress keyed by provider event id), `state` (access
derivation, and the single restriction writer: `state/restriction.ts` decides
NONE / FREE_QUOTA / SPEND_CAP / PAYMENT_FAILED from the whole account state
with PAYMENT_FAILED > SPEND_CAP > FREE_QUOTA, and
`reconcileRestriction` is the only code that writes `subscriptions.restriction`
or `websites.isBlocked`; every payment, cap, quota, trial, plan-change and
site-creation flow changes its fact and calls it, never deciding on its own).

Paddle is the merchant of record, which is why it is the provider: it sells,
charges tax and pays out, so no card detail reaches this server. It also has
neither usage metering nor a provider-side schedule for an item change, and
those two absences shape the domain:

- a plan is exactly **one** recurring price. Overage is billed from our ledger
  as a one-off charge (`chargeOverage`, `reporting/overage-charge.service.ts`)
  when a period closes: units are `ceil(events / 1,000)` at the plan's
  `overagePricePer1k`, `effective_from: immediately`, keyed
  `<periodId>:<cumulative>` and stamped into the charge's `custom_data` as
  `webyz_charge_key` (snake case: the SDK snake-cases custom data on the way
  out) so a retry after a crash cannot bill twice. Paddle refuses any
  transaction under 70c (`BILLING_CONFIG.usage.minChargeCents`), so overage
  worth less is **waived**: a `usage_records` row with status `WAIVED`, the
  checkpoint moved, no transaction; reconciliation counts waived events as
  settled. The charge job takes an optional `scope`, and database tests MUST
  pass it. Paddle bills a one-off item's raw amount in the **subscription's**
  currency regardless of the currency code sent (verified), so the provider
  refuses to charge overage into a subscription not in the plan's currency
  (`assertChargeCurrency`); the account's automatic currency conversion must
  stay off (runbook 1.2a).
- an annual plan is one yearly price. The provider period is the prepaid year
  (the base period); the monthly usage window is derived locally
  (`subscription/periods.ts`, anchored to the base start, clipped to the year)
  and rolled by `rollLocalUsagePeriods` in the usage sync, because nothing at
  the provider moves it.
- Paddle's Retain payment-recovery setting must not cancel on a failed charge,
  or a failed monthly overage charge would revoke a prepaid year. There is no
  API for it: it is a dashboard-only runbook item.
- Webhooks: `provider/paddle-ips.ts` refuses deliveries from addresses Paddle
  does not publish at `GET /ips` (fetched, cached an hour, "unknown" falls
  through to the signature check); `PADDLE_IP_ALLOWLIST` defaults on in
  production, off in development. The billing page initialises Paddle.js on
  load with `pwCustomer` (Paddle Retain) for accounts the provider knows, via
  `GET /billing/checkout-config`, and locks the checkout email
  (`allowLogout: false`) because Paddle attaches a subscription to the email
  typed in. The marketing site has `/refunds`; the terms link to it.

Email and password reset are implemented. With no provider configured the
console transport logs each message, so password reset works in development
straight from the server log. Set `RESEND_API_KEY` to send for real; there is no
SMTP transport, deliberately, because adding a mail library for an unused path
was not worth the dependency.

Geo breakdowns return nothing until a MaxMind database is present. Set
`MAXMIND_LICENSE_KEY` and run `npx tsx scripts/update-geo.ts`; without it
`geo-loader.service.ts` logs a failure and every country field stays empty,
which is why the Geography card can look empty on a working install.

Google Search Console integration (`core/gsc/`, the Search page) is
implemented Plausible-style: OAuth per site, property picked in settings,
data pulled live from Google and cached 10 minutes in Redis, never stored.
It is disabled until the Google login OAuth client is configured
(`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) with the extra redirect URI
`/api/v1/gsc/callback` registered and the "Google Search Console API" enabled
in the Google Cloud project. The OAuth exchange and live queries have not run
against real Google credentials yet; every state the UI can reach without
them (unconfigured, unconnected, no property, reauth) is exercised.

## API architecture

Layered, one direction only: `routes` -> `controllers` -> `core/<domain>/*.service` -> `db/clickhouse/*` or Prisma.

- `src/db/clickhouse/*` holds raw SQL only. Always parameterized with ClickHouse `{name:Type}` placeholders and `query_params`. Never interpolate user input into SQL.
- `src/core/<domain>/*.service.ts` shapes and computes (percentages, bounce rate, comparisons). Services take `AppContext` (or a narrower `{ clickhouse }`) as the first argument, never the Fastify request.
- `src/controllers/*` parse `request.params`/`request.query`, normalize via `http/normalize/*`, call a service, return `sendResponse`.

`AppContext` (`src/lib/context.ts`) is `{ clickhouse, prisma, redis }`, attached per request as `request.ctx` by `plugins/external/context.ts`. Pass `request.ctx` down rather than importing singletons inside services.

### Routing and URL prefixes

`src/app.ts` autoloads `plugins/external/*` then `routes/*` with prefix `/api`. `@fastify/autoload` derives prefixes from **directory** names only, never filenames. So everything in `src/routes/v1/` is mounted at `/api/v1/<path declared in the file>`:

- `routes/v1/analytics.ts` declares `/:siteId/browsers` -> `GET /api/v1/:siteId/browsers`
- `routes/v1/tracker.ts` declares `/track` -> `POST` and `GET /api/v1/track`
- `routes/v1/user-auth.ts` declares `/users/auth/login` -> `POST /api/v1/users/auth/login`

Analytics endpoints therefore sit directly under `/api/v1/:siteId/...` with no `analytics` segment. Adding a new domain file to `routes/v1/` does not add a URL segment; declare the full sub-path inside the file.

CORS is driven by `CORS_ORIGINS` in `config/env.ts`, defaulting to `FRONTEND_URL` plus `MARKETING_URL`. It is a strict allowlist because auth rides on a cookie.

### Response and error envelopes

Success goes through `sendResponse` (`src/http/helper/send-response.ts`): `{ success: true, data, meta: { requestId, ... } }`.

Errors go through `registerErrorHandler` (`src/plugins/error-handler.ts`): `{ success: false, error: { code, message, details } }`, where `details` is stripped in production. Expected failures must be created with `createAppError` (`src/errors/app-error.ts`), which sets `isOperational` and `statusCode`; add named factories to `src/errors/domain-errors.ts` rather than throwing raw `Error`. A raw `Error` becomes a 500 with a generic message.

Auth is cookie-session based, not JWT. `SESSION_COOKIE_NAME` is `webyz_session`; `plugins/auth.plugin.ts` validates it against the Postgres `sessions` table (Redis-cached for 5 minutes) and sets `request.session`. Protect a route with `preHandler: [fastify.authenticate]`.

Account self-service (`core/auth/account.service.ts`): `GET /api/v1/users/me/export` returns the account's data as one JSON attachment (profile, sites with goals and funnels, subscriptions, sessions, API key metadata, provider invoices; analytics are pointed at the per-site CSV export, not inlined). `DELETE /api/v1/users/me` needs the password for password accounts, cancels every provider-backed subscription immediately through `BillingProvider.cancelNow` and aborts with 502 `SUBSCRIPTION_CANCEL_FAILED` if the provider refuses (an account must never vanish while a card is still billed), purges ClickHouse for every site via `db/clickhouse/website.ts` `purgeWebsiteAnalytics` (events, sessions, event_data, hourly_aggregates), writes a `deleted_accounts` tombstone (email hash, trial and paid facts) that `startTrial` checks so delete-and-re-register cannot mint another trial, clears caches, then deletes the user row and lets Postgres cascade. The dashboard page is `/settings/account`, which also hosts change password.

The same plugin also accepts `Authorization: Bearer wbz_...` personal API keys (`core/auth/api-keys.service.ts`): only the SHA-256 of a token is stored, the token is shown once at creation, and a key resolves to the same `request.session` shape as a cookie with `request.auth.kind === "api_key"`. Keys are **read-only**: any method other than GET or HEAD is refused with 403 `API_KEY_READ_ONLY` before the handler runs. The plan's `api_access` entitlement is checked on creation and on every use, so a downgrade switches keys off. Management routes are `GET/POST /api/v1/api-keys` and `DELETE /api/v1/api-keys/:keyId`; the dashboard page is `/settings/api-keys`.

`auth.plugin.ts` and `site-access.plugin.ts` are registered explicitly in `app.ts` and **awaited before the route autoload**, because routes reference `fastify.authenticate` at registration time. Only `plugins/external/*` is autoloaded.

### Email and password reset

`core/email/` is a two-file abstraction: `transports.ts` picks a transport
(`resend` over plain HTTP via axios when `RESEND_API_KEY` is set, otherwise
`console`), and `email.service.ts` exposes `sendEmail`, which **never throws**
and returns whether the message went out. Every caller is a background job or a
flow whose success must not hinge on the mail provider.

Templates live in `core/email/templates/index.ts`: password reset, password
changed, quota warning (80/90/100%), and over quota.

Password reset (`core/auth/password-reset.service.ts`):

- Only the SHA-256 of the token is stored, so a database leak yields no working
  links.
- `requestPasswordReset` always resolves, whether or not the address exists and
  whether or not the account is Google-only, so the endpoint cannot enumerate
  accounts. Both API responses are byte-identical.
- Requesting a new link retires any earlier unused one.
- Missing, used and expired tokens all return the same message.
- Completing a reset revokes every session, so an attacker holding one is cut
  off, and sends a notification email.

### Site access control

Analytics reads are guarded by `preHandler: [fastify.optionalAuthenticate, fastify.authorizeSite]`. `authorizeSite` resolves `:siteId` into `request.website` (id, domain, timezone, owner, visibility, share password hash, members; Redis-cached for a minute) and sets `request.siteRole`: `owner`, `admin` or `viewer` for the owner and `WebsiteMember` rows, `public` for anyone when `isPublic` (and, when the share has a password, only with a valid `X-Share-Token` header, else 401 `SHARE_PASSWORD_REQUIRED`), nobody else. It also carries the timezone every period calculation needs. Call `fastify.invalidateSiteCache(siteId)` after any site, sharing or membership mutation. Share tokens (`core/website/share-token.ts`) are HMACs keyed by the site's bcrypt password hash, so no extra secret exists and changing the password revokes them all.

Team members (`core/website/members.service.ts`, `routes/v1/team.ts`): roles are per site; seats are the owner's plan `team_members` entitlement, owner included, with pending invitations holding a seat; invitations are SHA-256-stored tokens emailed as `/invitations/:token`, accepted only by a signed-in account with the invited address. Access helpers in `website.service.ts`: `getOwnedWebsite` (delete only), `getManagedWebsite` (owner or admin: settings, goals, funnels, sharing, notifications, members), `getAccessibleWebsite` (any member: reads). `listWebsites` returns owned plus shared sites with a `role`. Owner-only-looking analytics endpoints (realtime visitors, stream, export) check `request.siteRole !== "public"`. Plan-gated site routes (funnels, Search Console) run `authorizeSite` before `requireEntitlement` so the site owner's plan decides, not the caller's.

Notifications (`core/notifications/`, `routes/v1/notifications.ts`): `EmailReport` rows (weekly after Monday 09:00 and monthly after the 1st 09:00 in the site's timezone, `lastPeriodEnd` prevents a resend) and one `TrafficAlert` per site (live visitors at or over the threshold, 12 hour cooldown), sent by the hourly `email-reports` and five-minute `traffic-alerts` cron jobs. The pure period arithmetic lives in `report-periods.ts` and is tested.

## Tracking and ingest path

1. `apps/api/public/js/script.js` is served by `@fastify/static` from `process.cwd()/public`, i.e. `GET /js/script.js`. It is configured entirely by `data-*` attributes on the script tag (`data-site-id`, `data-endpoint`, `data-track-localhost`, `data-debug`, ...). See `examples/tracker/basic.html`. Optional automatic events, each behind one attribute and documented in `docs/tracker.md`: `data-hash-routing` (hashchange counts as a pageview; the server already keeps the fragment in `url_path`), `data-outbound-links` (`Outbound Link: Click`, prop `href`), `data-file-downloads` (`File Download`, prop `href`, list overridable with `data-file-types`) and `data-track-404` (`404`, prop `page`, fired on pages carrying `<meta name="webyz-404">`, because a script cannot see the HTTP status). `url`, `path`, `title`, `name`, `ref`, `lang`, `screen` are reserved payload keys and never become properties.
2. It is cookieless and stores nothing in the browser (the only exception is the `webyz-disabled` localStorage flag written by `webyz.optOut()`). It sends a short-key payload: `t` (pageview|event), `sid` (website id), `pid` (in-memory pageview id), `url`, `ref`, `title`, `lang`, `screen`, plus custom props. The event time is the server's receive time, never a client value: `ts` is still accepted from old scripts and ignored (`ingest/normalize/timestamp.ts`), because usage is billed by the hour an event carries and a client must not be able to place events in a closed period, past the retention cut or in the future. Visitor and session identity are derived on the server by `src/ingest/identity/visitor-identity.ts`: `user_id = sha256(daily_salt + website_id + ip + user_agent)` with a random salt per UTC day kept in Redis for 48 hours, and `session_id` from a Redis key per visitor with a 30 minute sliding TTL. The same person is therefore one visitor within a day and unlinkable across days, a session never crosses UTC midnight, and the IP is never written anywhere. Old cached scripts may still send `vid`/`ssid`/`new_session`; they are accepted and ignored. If Redis is down, identity falls back to deterministic per-day and per-30-minute values so ingest never stops. The marketing site and the privacy policy (`apps/web/src/app/privacy`) describe this exactly; change them together.
3. `POST /api/v1/track` returns 204 on success; `GET /api/v1/track` always returns a 1x1 GIF (pixel fallback). Both run `checkIngestAllowed` then `publishTracking`. An unknown site id is a 404 so a bad install is visible; an over-quota site gets 202 with nothing written, because a visitor's browser is the wrong place to surface a billing problem.
Both routes carry `schemas/tracking.schema.ts`, validated by the tracker plugin's own Ajv (`removeAdditional: false`, unlike the app-wide validator, so custom event properties survive as extra keys and are bounded by `additionalProperties`; the POST body limit is 16 KB). A malformed POST is a 400; the GET attaches the validation error and still returns the pixel. `checkIngestAllowed` fails open only on connectivity errors (`core/tracker/connectivity.ts`: Prisma init and P1xxx errors, socket codes, pg terminated/timeout messages); anything else is rethrown so a bug can never switch quotas off. `normalizeMeta` keeps at most 30 custom properties of 500 characters.
4. `publishTracking` (`src/ingest/http/publish-tracking.ts`) normalizes and writes straight to ClickHouse in the same request.
5. Normalization (`src/ingest/normalize/normalize-tracking.ts`) does bot rejection (four filters under `core/bots/`, cheapest first, each drop counted per site and reason into the ClickHouse `dropped_events` table by `drops.ts` with `async_insert`, never with the address: `utils/bot-detection.ts`, the `ua-parser-js` bot database plus generic bot words and `HeadlessChrome`; `datacenter-ips.ts`, a sorted-interval match of the client address against `geo/datacenter-ips.txt` minus the allow ranges in `geo/datacenter-ips-allow.txt` (default Apple's iCloud Private Relay egress list: a third of its blocks sit inside the hosting ranges); `referrer-spam.ts`, the Matomo list in `geo/referrer-spam.txt`, matched on the referrer domain and its parents; and `clusters.ts`, Redis flags `bots:cluster:<site>:<screen>|<browser>|<language>` set for 24 hours by the five-minute `detect-scripted-traffic` job when a group of the last hour's sessions has 50+ visits from 20+ visitors, 95%+ bounces and zero engagement, on sites with at least 30 engaged sessions in the window (an absolute count: scripted sessions sit in the denominator of any share, and on the first live site they were 45% of the hour). The three lists are fetched daily by `update-bot-lists` (`list-updater.service.ts`, `scripts/update-bot-lists.ts`) from `DATACENTER_IP_LISTS`, `DATACENTER_IP_ALLOWLISTS` and `REFERRER_SPAM_LISTS`; `list-files.ts` reads the live copy in `geo/` and falls back to `lists-seed/`, written at image build (`BOT_LISTS_DIR`), so every filter works from the first request. `BOT_DATACENTER_FILTER=off` and `BOT_CLUSTER_FILTER=off` switch those two off; a missing file switches a list filter off), visitor identity (above), hostname extraction, URL/UTM/meta parsing, user-agent parsing, and MaxMind geo lookup.
6. `core/tracker/tracking.service.ts` inserts the event, then for pageviews upserts the session row.

`core/tracker/session.service.ts` writes `sessions` for pageviews and `core/tracker/engagement.service.ts` for engagement reports (`t: "engagement"` with `e` visible milliseconds and `sd` scroll percent, sent by the tracker on hide, blur, pagehide and before an SPA route change): an engagement extends `end_time`/`duration_seconds` to the report time, adds to `engaged_seconds`, maxes `scroll_depth`, writes an `engagements` row, and is dropped when no session exists; it is never inserted into `events`, so it is not billed (`billable.ts`) and not shown as activity. Both writers run under `core/tracker/session-lock.ts`, a per-session Redis lock (2 s TTL, 600 ms wait, proceeds unlocked if Redis is down): a route change sends the old page's engagement and the new pageview together, and two read-modify-write cycles on the same ReplacingMergeTree row lose whichever lands first without it. The tracker's engagement arithmetic is tested by running the real `public/js/script.js` in a fake browser under `node:vm` (`src/ingest/tracker-script.test.ts`). Because that table is a ReplacingMergeTree, "updating" a session re-inserts the whole row with a newer `updated_at`, so **every column must be carried forward explicitly or it is lost on the next pageview**. Attribution (`channel`, `referrer_domain`, `utm_*`) is first touch: computed by `ingest/helpers/channel.ts` when the session is created, then preserved.

Geo data lives in `apps/api/geo/`. `core/geo/geo-loader.service.ts` opens `geo/GeoLite2-City.mmdb` lazily and logs a failure without throwing, so geo silently degrades to empty fields if the DB is missing. `scripts/update-geo.ts` refreshes it with `MAXMIND_LICENSE_KEY`.

## Data model

### Postgres (Prisma)

`apps/api/prisma/schema.prisma`. Generated client is written to `src/generated/prisma` (custom `output`, `prisma-client` generator), so import from `../generated/prisma/client.js`, **not** `@prisma/client`. Regenerate after any schema change. Snake_case column names with `@map` throughout; keep that convention.

Models: `User`, `Session`, `PasswordResetToken`, `ApiKey`, `DeletedAccount`, `Website`, `Goal`, `Funnel`,
`FunnelStep`, `SearchConsoleConnection`, `Plan`, `Subscription`,
`BillingPeriodUsage`, `UsageRecord`.

Goals (event or exact page path, XOR) are managed in site settings; funnels
(2-8 ordered steps of the same shape) are managed on the Conversions page.
Funnel analysis is computed live per request with ClickHouse `windowFunnel`
grouped by session (`db/clickhouse/funnels.ts`); goal detail reuses
`sessionBreakdown` with a `conversion` session restriction.

Billing model, because it drives ingest behaviour:

- `Plan.extraPricePer100k` non-null means pay-as-you-go: overage is billed and traffic is **never** blocked. Null means a hard-limit (free) plan.
- The `enforce-limits` job flips `Website.isBlocked`; `checkIngestAllowed` reads it at ingest time. If Postgres is unreachable, `checkIngestAllowed` deliberately fails **open** to avoid data loss.
- `BillingPeriodUsage` is one row per subscription per period, synced from ClickHouse; `UsageRecord` is one row per overage charge sent to the provider, with the idempotency key and the transaction it created.

### ClickHouse

Database `webyz_analytics`. Migrations are plain SQL in `apps/api/clickhouse/migrations/`, applied in filename order by `scripts/clickhouse/migrate.ts`, which records applied filenames in a `migrations` table. Add a new numbered file; never edit an applied one.

- `events` - MergeTree, `PARTITION BY toYYYYMM(timestamp)`, `ORDER BY (website_id, timestamp, user_id, session_id)`. Custom props are the `meta.key` / `meta.value` array pair.
- `sessions` - **ReplacingMergeTree(updated_at)**, `ORDER BY (website_id, session_id)`. Almost all dashboard metrics come from here, not from `events`. Because rows are versioned, queries must deduplicate: either `FROM sessions FINAL` (used by the per-dimension queries in `db/clickhouse/*.ts`) or `argMax(col, updated_at) ... GROUP BY session_id` (used by `top-stats.ts`). Forgetting this double-counts sessions.
- `hourly_aggregates` - AggregatingMergeTree fed by `hourly_aggregates_mv` off `sessions`, holding `AggregateFunction` states for visits, pageviews, bounces, duration and `uniqCombined` visitors. Read with the matching `-Merge` combinators.
- `engagements` - MergeTree, one row per engagement report (website, session, user, timestamp, url_path, engaged_ms, scroll_depth), migration 011 (the session columns are 010), for time-on-page and scroll depth per page.
- `dropped_events` - MergeTree with a 400 day TTL, one row per request the bot filters refused (website_id, timestamp, reason), migration 012; read by `GET /:siteId/filtered-traffic` and the dashboard's filtered-traffic line.
- `event_data` - secondary table. (A `websites` table existed from migration 005 with nothing ever writing to it; migration 008 drops it. Site domain and timezone live in Postgres.)

Time ranges cross the wire as **Unix seconds**. `src/http/normalize/period.ts` turns `period` (`today`, `yesterday`, `last_7_days`, `last_28_days`, `last_91_days`, `this_month`, `last_month`, `this_year`, `last_12_months`, `all_time`, `custom`) plus optional `date`/`from`/`to` into `{ from, to }` seconds, with `to` exclusive (start of the next day). Unknown periods throw `invalidPeriod`.

Query conventions in `db/clickhouse/*.ts`: each dimension exposes a `...BasicQuery`, a `...DetailedQuery` (adds `visit_duration` and `bounce_rate`), and a `...TotalsQuery` used to compute percentages. `?detailed=true` on the endpoint selects the detailed variant.

CSV export: `GET /api/v1/:siteId/export?dataset=<name>&period=...` returns one `text/csv` attachment per dataset (`timeseries` or any breakdown URL segment, listed in `core/analytics/export.service.ts`, which also owns the segment -> dimension map the breakdown routes iterate). It honours the same period, `f.*` filters and retention cut as the dashboard, is owner-only, capped at 10,000 rows, and gated by the `exports` entitlement. Cells are escaped by `http/helper/csv.ts`, which also neutralises formula-leading text. The dashboard's download icon (`features/dashboard/components/ExportMenu.tsx`) fetches it as a blob so errors render in place.

Drill-down filters (Plausible style): overview endpoints (breakdowns, top-stats, main-graph, conversions, custom-events) accept `f.<key>` query params (`f.browser`, `f.page`, `f.country`, ...). `db/clickhouse/filters.ts` is the single allowlist turning them into parameterized SQL; values are matched against the same display expressions the breakdowns render, so the frontend sends the clicked label verbatim ("Chrome 120", "(direct)", "Direct"). Every filter is a `{ op, value }` condition; on the wire the operator is a value prefix (`!` is not, `~` contains, `!~` does not contain, `=` escapes a literal), parsed by `parseFilterValue` on both sides, so a bare value stays equality. `page` and `event` restrict via the events table (`session_id IN`, or `NOT IN` for a negative operator); `f.goal=<name>` is resolved by the analytics controller against the site's goals into one of those two before the query layer sees it. On the frontend they live in the URL as `f.*` params (`features/dashboard/filters.ts`); clicking a breakdown row applies an `is` filter, the Filter form offers the other operators, `FilterBar` shows them as removable pills, and a filtered dimension drills down in place (browser -> versions, country -> regions -> cities). Saved segments (`Segment` rows, `core/website/segments.service.ts`, `routes/v1/segments.ts`) store the wire form per site and are applied from the dashboard header's Segments menu, on shared dashboards too.

Sessions carry `screen` and `language` since ClickHouse migration 009 (rows from before are empty and excluded from those breakdowns); `session.service.ts` must carry them forward like every other column. Custom event properties are read straight from the `meta.key`/`meta.value` arrays with `ARRAY JOIN` (`GET /:siteId/custom-events/properties?event=&key=`, `db/clickhouse/goals.ts`); the Conversions card shows a Properties tab once an `event` filter is set.

## Frontend (apps/app)

The dashboard SPA. Routes: `/login`, `/signup`, `/share/:slug` (with a password
gate and `?embed=true&theme=&background=` for iframes), `/invitations/:token`
public; `/sites`, `/sites/add`, `/sites/:domain`, `/sites/:domain/settings`,
`/settings/billing` behind `ProtectedRoute` + `MainLayout`. Login honours
`location.state.from` for in-app paths so an invitation link survives sign-in.
Site settings sections are filtered by `site.role`: viewers see People only,
admins everything but the danger zone. `/` redirects to `/sites`. On the
hosted nginx, `/pricing`, `/terms`, `/privacy`, `/refunds` and `/docs` on the
app host forward to the marketing site (`infra/hosted/nginx/webyz.conf`). The root element in `index.html` is empty:
placeholder text there flashes before React mounts.

- The dashboard URL carries the site **domain** because it reads better than a
  UUID; `useSiteByDomain` resolves it to the site id from the cached site list.
  Analytics endpoints are always keyed by id.
- The selected period lives in the `?period=` query string so a view is
  linkable and survives reload.
- `lib/axios.ts` unwraps the API envelope: use the `get`/`getPaged`/`post`/
  `patch`/`del` helpers, which return `data` directly. Errors reject as a flat
  `{ status, code, message }`.
- Feature folders: `src/features/<feature>/{api.ts, schema.ts, types.ts,
  hooks/, components/}`. Pages compose feature components. shadcn primitives are
  in `src/shared/components/ui/`, with `Field`/`SelectField` wrappers in
  `src/shared/components/Field.tsx` for labelled, validated inputs.
- `BreakdownCard` is the one tabbed card behind Contents, Acquisition,
  Technology and Geography. It fetches **only the active tab**, and the detailed
  variant only while the expanded modal is open, which keeps the hook count
  fixed regardless of tab count.
- React Compiler is on via `babel-plugin-react-compiler`; avoid manual
  memoization unless profiling says otherwise.
- The website list and the header's site switcher show each site's own favicon
  (`SiteFavicon`, sizes `md` and `sm`), falling back to the coloured initial
  tile when there is none. The image comes from
  `GET /api/v1/favicon/:domain` (`core/website/favicon.service.ts`), which
  fetches from DuckDuckGo and then Google, caches the bytes in Redis for a
  week and a miss for a day, and answers 404 so the tile stays. The browser
  never calls an icon service itself: that would hand a third party the
  signed-in user's whole list of domains. The route is public because the
  dashboard loads it as an `<img>` and, on the hosted split-host setup, a
  cross-site image request carries no `SameSite=Lax` session cookie.

## Frontend (apps/web)

Next.js 16 App Router marketing site: landing (`/`), pricing (`/pricing`),
the rendered documentation (`/docs`, `/docs/<slug>`), the changelog
(`/changelog`) and the legal pages. Auth and the dashboard live in `apps/app`,
and the CTAs link there via `NEXT_PUBLIC_APP_URL`.

The changelog is the reader's release notes, not the operator's: `src/lib/changelog.ts`
holds dated entries written in product language, each item tagged new, improved
or fixed, rendered as a timeline at `/changelog` and as RSS at
`/changelog/rss.xml` (both prerendered, nothing fetched). The repository's
`CHANGELOG.md` stays the exhaustive Keep a Changelog file an operator scans
before upgrading; a release adds a section there and an entry here, and an
entry's `slug` is a published permalink that must not change.

The pricing page fetches the public `/api/v1/plans` list server side with a
5 minute revalidate, so marketing pricing and in-app billing cannot drift. If
the API is unreachable it renders an honest unavailable message rather than
hardcoded prices.

Page weight is a tracked concern (Lighthouse mobile, 10 Sep 2026: 92, LCP
2.8 s on the hero h1). That LCP is Lighthouse's simulation, not a paint the
h1 waits for: in every trace the h1 paints at first contentful paint, and the
"render delay" is the simulator charging every byte fetched before that paint
(fonts, the React and Next runtime, eager images) at 1.6 Mbps. So the number
moves with total initial bytes, and the runtime JS (about 175 KB gzipped, which
the App Router always ships) is most of it. `next.config.ts` inlines the CSS
(`experimental.inlineCss`, 9 KB gzipped, so no render-blocking request), the
handwriting face is a vendored 16 KB subset of Caveat (`src/fonts/README.md`:
the character set, the licence and how to regenerate it; `.hand` text must
stay within that set), only images in the first viewport are `eager`, and
nothing below the fold is `priority`. Check a change to the layout, fonts or hero against
`npx lighthouse <url> --form-factor=mobile` before shipping it.

Tailwind v4. Tokens live in `src/styles/tailwind.css` under `@theme`; the file
previously used v3 `@tailwind base/components/utilities` directives, which emit
nothing under `@tailwindcss/postcss`. The duplicate root `app/` starter that
used to shadow `src/app/` is gone.

## Open source

The code is licensed AGPL-3.0 (`LICENSE`). Public documentation lives in `docs/` (self-hosting, configuration, tracker, API, development, architecture) and is rendered by the marketing site at `/docs` and `/docs/<slug>` from those same files at build time (`apps/web/src/lib/docs.ts` lists the guides and rewrites GitHub-relative links; the web Docker image copies `docs/` for that reason) plus `README.md`, `CONTRIBUTING.md`, `SECURITY.md` and `CODE_OF_CONDUCT.md`; keep them in step with changes the same way as this file. The legal pages name the operator from `apps/web/src/lib/legal.ts`: an individual (name, city, country) during the beta because no company is registered, switchable to a company entity when payments open; the hosting provider (DigitalOcean, confirmed 10 Sep 2026) and the contact mailbox (`hello@webyz.io`, which must exist and be read) are filled in, and `reviewed` stays false until a lawyer has read the pages. `docs/api.md` is the contract external API-key users read: a change to an endpoint, parameter or error code is not done until that page says so.

## Deployment

`infra/hosted/` is how the hosted product (webyz.io, app.webyz.io,
api.webyz.io) runs: an overlay compose file layered on the open-source stack
(never edit `infra/` for hosting needs; add to the overlay), the marketing
service the open-source stack does not run, split-host URLs for the API, and
the three containers joined to the host's shared `nginx-proxy` container's
`proxy` network, reached by container name with no host ports. Cloudflare
fronts every hostname; `infra/hosted/nginx/cloudflare-real-ip.conf` unwraps
`CF-Connecting-IP` so the API's single trusted hop (`TRUST_PROXY=1`) yields
the visitor's address (verified: nginx logs the client, not the edge).
Certificates are Let's Encrypt through the host's existing certbot webroot and
daily cron (`certs.sh` for first issuance). A release is `git pull &&
./infra/hosted/deploy.sh` in `~/apps/webyz` on the server: builds the three
images there (the GHCR images are same-origin and not used), runs migrate,
starts, probes readiness. Secrets live only in `infra/hosted/environment`
(gitignored); `environment.example` lists every key. Docker's data root on
that host is `/home/docker`, not the 90%-full root partition.
`infra/hosted/backup.sh` is the nightly backup (cron, see the README there):
`pg_dump` of Postgres plus an online ClickHouse `BACKUP DATABASE` to the
`backups` disk the overlay mounts (`infra/hosted/clickhouse/backups.xml`),
kept `BACKUP_KEEP_DAYS` in `BACKUP_DIR` and copied to the rclone
`BACKUP_REMOTE` when set; `deploy.sh` runs the Postgres half before every
migration. The marketing image requires `NEXT_PUBLIC_SITE_URL`,
`NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_API_BASE_URL` as build args and fails
otherwise, because the code's localhost fallbacks once shipped a localhost
sitemap and canonical URLs. First deployed
9 Sep 2026; registration opened and the live Paddle keys added the same day.

`docs/self-hosting.md` is the public guide; `infra/DEPLOY.md` is its short form. The self-host model is Plausible-shaped: one server, one domain, one command. `infra/setup.sh <domain>` writes `infra/.env` (domain, `BASE_URL`, generated database passwords, empty optional keys), then `docker compose up -d` in `infra/` loads `docker-compose.yml` (Postgres, ClickHouse, Redis, a one-shot `migrate`, `api`, `app`, no host ports) plus the automatic `docker-compose.override.yml` (Caddy on 80 and 443 with Let's Encrypt for `DOMAIN`). Caddy routes the single domain by path: `/api/*`, `/js/*` and `/health*` to `webyz-api:3042`, everything else to `webyz-app:8080` (`infra/caddy/Caddyfile`); the dashboard's client routes never start with those prefixes, so same-origin means no CORS and no build-time URLs. `docker-compose.expose.yml` replaces the override for an existing reverse proxy (publishes the two services on `127.0.0.1`; `infra/reverse-proxy/nginx.conf.example` is the matching nginx). The stack runs only the product; `apps/web` (the hosted service's landing, pricing, docs and legal pages) is not in `infra/` at all and is deployed by its operators separately with `VITE_API_BASE_URL`/`VITE_MARKETING_URL` baked in for the split `app.`/`api.` hostnames. Images are `ghcr.io/webyz-org/webyz-api` and `webyz-app` (`IMAGE_REGISTRY`/`IMAGE_TAG` in `.env`), published by `.github/workflows/ci.yml` on pushes to `main` and `v*` tags for amd64 and arm64; the compose services carry `build:` too, so `docker compose build` produces the same images from a checkout. `REGISTRATION` (`core/auth/registration.ts`): `open` allows any signup; anything else allows only the first account, checked in both signup paths (password and a new Google account) and reported by `GET /users/auth/providers` as `registration` so the login page hides the signup link and the signup page explains. The compose stack and `setup.sh` default to `disabled`; the hosted product sets `open`. Every compose service caps its logs through an `x-logging` anchor (json-file, 10 MB, 5 files). ClickHouse mounts `infra/clickhouse/config.xml` and `users.xml` (warning-level logs, internal log tables removed, 2 GB per-query memory cap), the Plausible-style small-server profile. The dashboard image is `nginxinc/nginx-unprivileged` listening on 8080, so upstreams are `webyz-app:8080`; the bundled Caddy adds HSTS, nosniff, referrer and permissions headers to dashboard responses (the API sets its own through helmet), with no frame-ancestors rule because shared dashboards may be embedded. Repo hygiene for the public project: `CHANGELOG.md` (Keep a Changelog, with a Breaking subsection operators scan before upgrading), issue and PR templates and Dependabot under `.github/`, and a release process in `docs/development.md` (tag `vX.Y.Z`, CI publishes images, make the GHCR packages public once). The migrate role of the API image runs `scripts/migrate-deploy.sh` (Prisma migrate deploy, ClickHouse migrations, plan seed) without a package manager; `api` waits for it, so every `up` is migrate-then-start. `TRUST_PROXY=1` in `.env` matches the single proxy hop.

## Environment variables

`apps/api/.env` (loaded by `dotenv` in `src/config/env.ts`): `PORT`, `NODE_ENV`, `LOG_LEVEL`, `TRUST_PROXY`, `DATABASE_URL`, `CLICKHOUSE_HOST`, `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `REDIS_HOST`, `REDIS_PORT`, `MAXMIND_LICENSE_KEY`, `FRONTEND_URL`, `APP_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_ENVIRONMENT`, `PADDLE_IP_ALLOWLIST`, `BOT_DATACENTER_FILTER`, `DATACENTER_IP_LISTS`, `DATACENTER_IP_ALLOWLISTS`, `REFERRER_SPAM_LISTS`, `BOT_CLUSTER_FILTER`, `BOT_LISTS_DIR`.

`TRUST_PROXY` decides which upstream hops may set the client address (`config/trust-proxy.ts`): a hop count such as `1` for one load balancer or reverse proxy, a comma list of addresses or CIDRs, or `false` for direct connections. It is required in production (the server refuses to boot without it) and defaults to `false` in development. Every consumer of the client address (rate-limit keys, session IP records, geo, the visitor hash) reads `request.ip`, which Fastify resolves under this setting; nothing parses `X-Forwarded-For` by hand. It was `trustProxy: true` before, which believes the leftmost forwarded value and let any client forge its address.

`CLICKHOUSE_URL` is the single setting; `CLICKHOUSE_HOST` is still accepted as a legacy alias by `config/env.ts`. Add `CORS_ORIGINS` to allow extra front end origins, otherwise it defaults to `FRONTEND_URL` plus `MARKETING_URL`.

`apps/app/.env`: `VITE_API_BASE_URL` and `VITE_MARKETING_URL`, both optional. In `pnpm dev` they default to the local ports; in a production bundle an unset API URL means `window.location.origin`, because a self-hosted install serves the dashboard and the API from one domain and that is what lets one prebuilt image serve any domain. Set `VITE_API_BASE_URL` only when the API is on another origin (the hosted product). The value is always an absolute origin, so the install snippet can never be a relative `/js/script.js`. `src/config/env.ts` is the only reader; nothing else touches `import.meta.env`. There is no `apps/app/.env.example` yet: env files are write-protected for the assistant, so add one by hand with those two names.

`apps/web/.env`: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_API_BASE_URL`. See `apps/web/.env.example`.

## Gotchas worth remembering

- In `apps/app/src/index.css` the shadcn `@theme inline` block remaps `--color-primary` (and `--color-accent`, `--color-secondary`, `--color-border`) to the near-black shadcn variables, overriding the brand blue in `@theme static`. `bg-primary`/`text-primary` therefore render black. For brand-colored data-UI (chart, bars, selected states) use the `brand` / `brand-ink` tokens, plus `primary-soft`, which are not remapped. The app palette (bg, surface, text-*, brand) is theme-aware: values live on `:root` and `.dark` and are mapped in `@theme inline`, with the `.dark` class managed by `shared/lib/theme.ts` (persisted toggle, OS default). Chart.js cannot read CSS tokens, so `MainGraph` keeps a per-theme literal palette via `useTheme()`.

- Periods and graph buckets resolve in each site's own `Website.timezone`, carried on `request.website` by the site-access plugin. Do not reintroduce a hardcoded zone.
- ClickHouse `formatDateTime` uses `%i` for minutes; `%M` is the month name and silently produces labels like `14:August:00`.
- Health: `GET /health` (liveness, always 200) and `GET /health/ready` (Postgres, ClickHouse and Redis each pinged with a 2 second timeout; 503 if any fails), also mounted under `/api`. Both are exempt from the rate limiter. `src/http/health.ts`; registered in `app.ts`, not autoloaded, so it can live outside the `/api` prefix. Security headers come from `@fastify/helmet` in `app.ts`: a deny-all CSP with `frame-ancestors 'none'`, and `Cross-Origin-Resource-Policy: cross-origin` because customer sites load `/js/script.js` from another origin. HSTS is on in production only.
- `tsconfig.json` typechecks `src` and `scripts` with `noEmit`; `tsconfig.build.json` is the one that emits `dist` from `src` only. Build with the latter.
- Signup calls `startSubscriptionForNewUser`: a 30 day Growth trial (config in
  `catalog/billing.config.ts`, one per account via `users.trialUsedAt`) when
  eligible, otherwise the free plan. When email verification is required
  (`EMAIL_VERIFICATION`, `core/auth/email-verification.service.ts`: `auto` means
  required iff `RESEND_API_KEY` is set), a password signup instead gets Free and
  no session; `users.emailVerifiedAt` stays null, login answers 403
  `EMAIL_NOT_VERIFIED` (checked after the password so it cannot be probed), and
  `POST /users/auth/verify-email` redeems the SHA-256-stored single-use token,
  marks the address verified, starts the trial and signs the user in. Google
  signups are verified on creation. The migration that added the column
  backfilled every existing account as verified. A trial is a local `TRIALING` row with no
  provider object and a single usage period; it is a hard limit, since overage
  cannot be billed without a card. The hourly `trials` job sends the 7 and 3 day
  reminders and expires trials to Free, making sites over the free limit
  inactive (oldest stay active) rather than deleting anything. Job-wide trial and
  enforcement functions take an optional scope; database tests MUST pass it, or
  they act on every account in the dev database.
- Plan changes (`core/billing/subscription/plan-change.service.ts`): a higher
  plan, or monthly to annual, is an upgrade and applies now with provider
  proration (`prorated_immediately`, `on_payment_failure: prevent_change`, so
  an upgrade nobody paid for never applies); a lower plan, or annual to
  monthly, is a downgrade. Paddle has no schedule for an item change, so a
  downgrade tells the provider to bill the new price from the next renewal and
  charge nothing now (`do_not_bill`), and the boundary is a local record:
  `pendingPlanId` / `pendingBillingCycle` / `pendingChangeAt`. While that is in
  the future `syncSubscription` pins the local plan to what the customer paid
  for even though the provider already carries the new price; once it passes,
  the provider's price decides and the pending record clears. The hourly
  `apply-plan-changes` job (and any renewal webhook) does that crossing.
  Undoing a pending downgrade puts the provider back on the current plan's
  price. If a due pending change names a plan the provider is not on, the
  provider wins and the mismatch is logged as an ANOMALY: entitlements never
  outrun the money.
  Every change is previewed first (entitlement diff, sites that would go
  inactive, effective date). When a plan change lands, `syncSubscription`
  reconciles active sites to the new limit (active first, then oldest) and
  emails once. Cancellation keeps access to the base period end and is
  previewed the same way. Nothing in these flows deletes data.
- Spending protection (`core/billing/spend-cap/`): the cap is a monthly figure
  including the base, measured against the annual price / 12 for yearly plans.
  It applies only to provider-backed pay-as-you-go subscriptions; free and trial
  have none. Defaults and bounds come from the plan row (seeded from catalog
  multipliers). Raising applies now and lifts a SPEND_CAP restriction; lowering
  below what the period already cost is stored in `pendingSpendCapCents` and
  applied when the next usage period opens. Enforcement restricts at the cap and
  emails once per period through `billing_notifications`.
- Plan entitlements are enforced at the API, never only in the UI.
  `fastify.requireEntitlement(<feature>)` (plugins/entitlement.plugin.ts) is
  the preHandler; it resolves the plan of the account in scope (the site owner
  when `authorizeSite` ran, else the session user) through
  `core/billing/entitlements/entitlement.guard.ts` and rejects with 403
  `FEATURE_NOT_AVAILABLE` (details: feature, plan). Gated today: funnels
  (conversions routes), journeys (analytics route, owner's plan also on public
  dashboards), search_console (every GSC route; the Google callback checks in
  the service), exports (`GET /api/v1/:siteId/export`, owner only) and
  api_access (key creation and every bearer-key request). Retention is an access rule, not deletion: every analytics
  read resolves its period through `resolveRetainedWindow`
  (core/billing/entitlements/retention.ts), which cuts the window at local
  midnight `retention_days` ago in the site's timezone and reports the cut in
  `meta.retention`; the top-stats comparison window is bounded the same way.
  `team_members` is enforced by `inviteMember` (owner's plan, owner included,
  pending invitations count); the plan grids still omit it and can now list
  it.
  The dashboard reads `plan.entitlements` from `GET /billing/usage`
  (`useEntitlements`, `FeatureGate`, `RetentionNotice`) only to hide and
  explain; it is not the security boundary.
- Every new user gets a free-plan `Subscription` at signup, and the hourly `sync-usage` job backfills one for any user without a live subscription. Usage sync and quota enforcement both iterate subscriptions, so a user without one is never metered.
- Ingest drops events whose page hostname does not match the site's domain (or a subdomain, or localhost) with a 202 when `INGEST_HOSTNAME_CHECK` is on (`utils/hostname.ts`); Search Console refresh tokens are AES-256-GCM encrypted at rest under `ENCRYPTION_KEY` (`core/gsc/token-crypto.ts`, legacy plaintext rows pass through until reconnect); request logging is a route-pattern line from an `onResponse` hook in `app.ts` with `disableRequestLogging` and pino `redact` for credentials; the rate limiter uses the Redis store; the console mail transport prints bodies only outside production; the dashboard has an `ErrorBoundary` at the root and around the routed page, a `SessionWatcher` that reacts to the `webyz:unauthorized` event `lib/axios.ts` fires on any non-auth 401, and reads the pause reason from the usage summary's `access.reason`.
- Redis is never the source of truth, so the shared client
  (`lib/redis-client.ts`, options; `lib/redis.ts`, the process-wide instance)
  fails fast: no offline queue and a 2 second command timeout, so a command
  issued while Redis is down rejects at once and one Redis accepted but never
  answered rejects after 2 seconds. Every consumer treats that rejection as a
  miss: sessions, sites, entitlements and API keys fall through to Postgres,
  visitor identity to its deterministic salt and 30 minute buckets, the rate
  limiter lets requests through (`skipOnError`), cron skips the window, the
  Search Console caches refetch. Only the OAuth state keys (Google login,
  Search Console connect) require Redis outright. The realtime pub/sub
  subscriber keeps the offline queue so a SUBSCRIBE issued during a reconnect
  is still sent. Before this the API stalled for the length of a Redis outage
  instead of degrading. A new Redis call site must either `.catch` to a
  fallback or be something that genuinely cannot work without Redis.
- Cron jobs keep their Redis lock for 90% of the interval, so restarting the API does not re-run a job that already ran this window. To exercise a job right after a code change, delete `cron:lock:<name>` in Redis first. A job that resolves `"skipped"` (missing configuration, e.g. `update-geo` without `MAXMIND_LICENSE_KEY`) releases its lock, so adding the setting and restarting runs it; before that fix the weekly geo job held its lock for six days after one skipped run, which is how production had a key set and no database. `npx tsx scripts/update-geo.ts` (inside the api container: `node_modules/.bin/tsx scripts/update-geo.ts`) downloads it immediately.
