# Architecture

Three deployable apps and three stores. The shape is close to Plausible's: a tiny script posts to an API, the API writes to a column store, the dashboard reads aggregates.

```
customer site ──script.js──▶ POST /api/v1/track ──▶ normalise ──▶ ClickHouse (events, sessions)
                                                        │
                                            Postgres (accounts, sites, plans, usage)
                                            Redis (caches, salts, locks, realtime fan-out)
dashboard (React) ──cookie or API key──▶ /api/v1/:siteId/... ──▶ ClickHouse aggregates
marketing (Next.js) ──▶ /api/v1/plans
```

## Ingest

1. `apps/api/public/js/script.js` sends a short-key JSON payload: type, site id, URL, referrer, title, language, screen, timestamp, custom props. No identifiers.
2. `POST /api/v1/track` first asks `checkIngestAllowed`: does the site exist, is it active, does the account's plan state allow ingest. An unknown site is a 404 so a bad install is visible; a paused site gets a 202 with nothing written. If Postgres is unreachable this check fails open, because losing a customer's data is worse than a few unbilled events.
3. Normalisation rejects bots, extracts the hostname, parses URL and UTM parameters and the user agent, resolves geo from the IP with a local MaxMind database, and derives identity.
4. Identity is cookieless. `visitor_id = sha256(daily_salt + site + ip + user_agent)`; the salt is random per UTC day and kept in Redis for 48 hours. The session id lives in Redis under a 30 minute sliding TTL per visitor. A person is one visitor within a day and unlinkable across days; the IP is never stored.
5. The event row is inserted, the realtime channel is notified, and for pageviews the session row is upserted.

## Storage

**ClickHouse** (`webyz_analytics`) holds the firehose. `events` is a MergeTree partitioned by month. `sessions` is a ReplacingMergeTree keyed by site and session, versioned by `updated_at`: extending a session means re-inserting the whole row, so every query deduplicates with `FINAL` or `argMax`. Almost every dashboard number comes from `sessions`, not `events`. Attribution (channel, referrer, UTM) is first-touch, fixed when the session is created. `hourly_aggregates` is an AggregatingMergeTree fed by a materialised view.

**Postgres** (Prisma) holds accounts, sessions, API keys, websites, goals, funnels, Search Console connections, and the whole billing model: plans with their entitlements as JSON, subscriptions, per-period usage, usage reports to the provider, invoices and notifications. Column names are snake_case.

**Redis** caches sessions, site lookups and entitlements for a minute or five, holds the daily identity salt and per-visitor session keys, coordinates cron locks, and fans out realtime events to open dashboards.

## Reading

Every analytics endpoint sits under `/api/v1/:siteId/...`. A site-access plugin resolves the id, allows the owner or anyone if the dashboard is public, and carries the site's timezone so every period and graph bucket is computed in local time. A retention rule cuts the window to what the owner's plan keeps. Drill-down filters arrive as `f.<key>` query parameters and are turned into parameterised SQL by one allowlist.

Each breakdown has a basic query and a detailed one (adds bounce rate and duration) plus a totals query for percentages. Funnels are computed live with `windowFunnel` grouped by session. Journeys walk `sessions` and `events`. Realtime reads the last minutes and streams new events over server-sent events.

## Auth

Cookie sessions, not JWT: a `webyz_session` cookie is validated against Postgres with a Redis cache. The same plugin accepts `Authorization: Bearer wbz_...` personal API keys, stored as SHA-256 hashes, read-only by construction (any non-GET is refused before the handler) and gated by the plan's `api_access` entitlement on every use. Google OAuth is optional and switched off until its client is configured.

## Billing

One folder per concern under `core/billing`: catalog (the only place plan numbers live, seeded into Postgres), entitlements (feature gates enforced at the API), usage (hourly buckets, period rollover), reporting (one overage charge per closed period), subscription lifecycle and plan changes, webhooks (idempotent on provider event id), spend caps, trials, and a single restriction writer that decides whether ingest is paused and why. Payments go through Paddle, which is the merchant of record, so no card detail ever reaches this server; its SDK is imported in exactly one place behind a provider interface with a fake for tests. Paddle has no usage metering and no provider-side schedule for a plan change, so overage arithmetic and deferred downgrades are ours: the ledger decides what to charge, and a local pending record holds a downgrade until the paid period ends. Nothing in these flows deletes data; downgrades make excess sites inactive and keep their history.

## Front ends

The dashboard is a Vite React SPA with feature folders. It reads entitlements only to hide what would fail and explain why; the API enforces. The selected period and filters live in the URL so a view is linkable. The marketing site fetches the plan list from the API with a five minute revalidate so pricing cannot drift from what is billed, and hosts the privacy and terms pages.

## Deployment

Three images built from the repo root so pnpm sees the workspace lockfile. The API image also serves as the migration runner by command. Compose runs a one-shot migrate before the API and joins the web-facing containers to a proxy network; Caddy or your own nginx terminates TLS. See [self-hosting.md](self-hosting.md).

For the reasoning behind specific decisions, `CLAUDE.md` at the repo root goes deeper than this page and is kept in step with the code.
