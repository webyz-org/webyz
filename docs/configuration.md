# Configuration

Every setting is an environment variable. The API reads `apps/api/.env` in development (through `dotenv`) and the process environment in production; the compose stack builds the API's environment from `infra/.env`. The two front ends inline their `VITE_*` and `NEXT_PUBLIC_*` values at build time, so changing them means rebuilding.

## API (`apps/api`)

### Required

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Postgres connection string, e.g. `postgresql://webyz:password@postgres:5432/webyz` |
| `CLICKHOUSE_URL` | e.g. `http://clickhouse:8123`. `CLICKHOUSE_HOST` is accepted as a legacy alias |
| `TRUST_PROXY` | **Required in production**, defaults to `false` in development. Which upstream hops may set the client address: a hop count such as `1` for one reverse proxy, a comma list of addresses or CIDRs (`10.0.0.0/8`, `loopback`), or `false` when clients connect directly. Never `true`. The rate limiter, session records, geo lookup and the visitor hash all depend on it |
| `EMAIL_VERIFICATION` | `auto` (default) requires password signups to confirm their address by email when `RESEND_API_KEY` is set and skips it otherwise; `required` and `off` force either. Unverified accounts sit on Free and cannot sign in; the trial starts when the link is opened. Google signups are verified on creation. `EMAIL_VERIFICATION_TTL_HOURS` (24) is the link's lifetime |
| `REGISTRATION` | `open` lets anyone create an account (the hosted product). Any other value, `disabled` by convention, allows only the first account and closes signups after it; the login page hides the signup link. The self-host stack defaults to `disabled` |
| `FRONTEND_URL` | Public origin of the dashboard, e.g. `https://app.example.com`. Used for CORS, OAuth redirects, share links and links in email |

### Databases and cache

| Variable | Default | Notes |
| --- | --- | --- |
| `CLICKHOUSE_USER` | `default` | |
| `CLICKHOUSE_PASSWORD` | empty | |
| `CLICKHOUSE_DB` | `webyz_analytics` | |
| `REDIS_HOST` | `127.0.0.1` | |
| `REDIS_PORT` | `6379` | |

### Server

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3042` | |
| `NODE_ENV` | `development` | `production` switches on JSON logs, secure cookies, HSTS, and the required-variable checks |
| `LOG_LEVEL` | `info` | pino level |
| `APP_URL` | `FRONTEND_URL` | Where email links point; only set if it differs |
| `MARKETING_URL` | empty in production | Origin of the hosted service's marketing site, added to the CORS allowlist when set. Self-hosted installs leave it unset |
| `CORS_ORIGINS` | `FRONTEND_URL,MARKETING_URL` | Extra dashboard origins, comma separated. Ingest accepts any origin regardless |

### Ingest

| Variable | Default | Notes |
| --- | --- | --- |
| `INGEST_HOSTNAME_CHECK` | `on` | Drops events whose page hostname is not the site's domain, a subdomain of it, or localhost, so a site id copied from a snippet cannot be used to pollute that site's numbers. `off` disables it for a site served from many unrelated domains |

### Email

| Variable | Default | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | empty | When set, email is sent through Resend. When empty, no mail is sent: in development each message is printed to the log so reset and confirmation links are usable locally, in production only a warning naming the subject and recipient is logged. Set it before real users arrive |
| `EMAIL_FROM` | `Webyz <onboarding@resend.dev>` | Sender for all mail; use an address on a domain verified in Resend |
| `PASSWORD_RESET_TTL_MINUTES` | `30` | How long a reset link stays valid |

There is no SMTP transport. `SMTP_URL` is read but unused; contributions welcome.

### Google

| Variable | Notes |
| --- | --- |
| `ENCRYPTION_KEY` | 64 hex characters (`openssl rand -hex 32`). Encrypts the Search Console refresh token at rest with AES-256-GCM. Required in production when Search Console is enabled; `setup.sh` generates it. Changing it makes existing connections unreadable until sites reconnect |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client for Google sign-in and Search Console. Both empty means both features are off and the login page shows no Google button |
| `GOOGLE_REDIRECT_URI` | `https://api.example.com/api/v1/users/auth/google/callback`; register it in the Google Cloud console |
| `GSC_REDIRECT_URI` | Defaults to the login redirect's origin plus `/api/v1/gsc/callback`; register it too and enable the Search Console API on the project |

### Billing

| Variable | Notes |
| --- | --- |
| `PADDLE_API_KEY` | Paddle Billing API key (`pdl_live_apikey_...` or `pdl_sdbx_apikey_...`). Manages subscriptions, charges and transactions |
| `PADDLE_CLIENT_TOKEN` | Paddle client-side token (`live_...` or `test_...`). Public by design: the API serves it to the dashboard so checkout can open. Paid plans are purchasable only when this and the API key are both set |
| `PADDLE_WEBHOOK_SECRET` | The notification destination's secret key (`pdl_ntfset_...`). Every webhook is rejected unless its signature matches |
| `PADDLE_ENVIRONMENT` | `sandbox` or `production`. Defaults from the API key, which carries `sdbx` for sandbox keys |
| `PADDLE_IP_ALLOWLIST` | `on` refuses webhook deliveries from addresses Paddle does not publish at `GET /ips` (fetched, cached an hour, never hard-coded). Default `on` in production, `off` elsewhere because a development tunnel delivers from its own address. Needs `TRUST_PROXY` to be right behind a proxy |

Point the Paddle notification destination at `https://<api-host>/api/v1/paddle/webhook`. Read `apps/api/docs/billing-runbook.md` before going live; the payment-recovery setting there is not optional.

Self-hosters normally leave Paddle empty. See [self-hosting.md](self-hosting.md) for what that means for plans.

### Geo

| Variable | Notes |
| --- | --- |
| `MAXMIND_LICENSE_KEY` | Free GeoLite2 key. The weekly `update-geo` job (first run five minutes after start) downloads `GeoLite2-City.mmdb` into `apps/api/geo/` (a volume in Docker). Without it, country, region and city stay empty |

### Kafka (optional, off by default)

| Variable | Default | Notes |
| --- | --- | --- |
| `KAFKA_ENABLED` | `false` | When `true`, ingest produces to Kafka and a separate worker (`node dist/worker.js` with `WORKER_TYPE=tracking`) writes to ClickHouse |
| `KAFKA_BROKERS` | empty | Comma separated |
| `KAFKA_TOPIC` | `tracking-events` | |

## Dashboard (`apps/app`)

Nothing is required. A self-hosted install serves the dashboard and the API from one domain, so the dashboard uses its own origin for the API at runtime, which is what lets the prebuilt image work for any domain. In `pnpm dev` both variables default to the local ports.

| Variable | Notes |
| --- | --- |
| `VITE_API_BASE_URL` | Optional. Set at build time only when the API is on a different origin than the dashboard (the hosted product runs `app.` and `api.` subdomains). Every API call, the Google login link and the install snippet are built from it; when unset, from `window.location.origin` |
| `VITE_MARKETING_URL` | Optional, unset on self-hosted installs. Origin of the hosted service's marketing site, for the Home link and the terms and privacy links on login and signup; empty hides them |

## Marketing site (`apps/web`)

Not part of a self-hosted install. `apps/web` is the hosted service's public landing, pricing, documentation and legal pages; it is listed here because it lives in this repository.

| Variable | Default | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3041` | Where "Log in" and "Start free" go |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3042` | The pricing page fetches `/api/v1/plans` from here, on the server, so this must be reachable from the web container |
| `NEXT_PUBLIC_GITHUB_URL` | the upstream repository | The "View on GitHub" link |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3040` | The site's own public origin, for canonical URLs, Open Graph tags and the sitemap |

The localhost defaults exist for `pnpm dev`. `apps/web/Dockerfile` requires `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_API_BASE_URL` as absolute origins and fails the build otherwise, because the values are inlined at build time and a missing one would publish localhost links.

Company facts for the privacy and terms pages are code, not environment: `apps/web/src/lib/legal.ts`.

## Compose stack (`infra/.env`)

`infra/setup.sh` writes this file. The compose files derive the API's environment from it so passwords and the hostname are written once:

| Variable | Notes |
| --- | --- |
| `DOMAIN` | The public hostname, e.g. `analytics.example.com`. Caddy issues its certificate |
| `BASE_URL` | `https://` plus `DOMAIN`. Becomes the API's `FRONTEND_URL` and `APP_URL` and the Google redirect base |
| `POSTGRES_PASSWORD`, `CLICKHOUSE_PASSWORD` | Generated by `setup.sh`; used only inside the stack |
| `TRUST_PROXY` | `1` for the bundled Caddy or one proxy of your own |
| `IMAGE_REGISTRY`, `IMAGE_TAG` | Where prebuilt images come from (`ghcr.io/nihalnclt`) and which tag (`latest` or a version) |
| `API_BIND`, `API_PORT`, `APP_BIND`, `APP_PORT` | Only with `docker-compose.expose.yml`: where to publish the services for an external proxy; default `127.0.0.1`, `3042` and `3041` |
| Integration keys | `RESEND_API_KEY`, `EMAIL_FROM`, `MAXMIND_LICENSE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_ENVIRONMENT`, `PADDLE_IP_ALLOWLIST`, `CORS_ORIGINS`, `LOG_LEVEL`, passed through to the API |
