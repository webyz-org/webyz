# Self-hosting Webyz

One server, one domain, one command. The stack is Postgres, ClickHouse and Redis, the Webyz API and dashboard, and Caddy in front terminating TLS with automatic certificates. The dashboard and the API share the domain: Caddy sends `/api/*`, `/js/*` and `/health` to the API and everything else to the dashboard, so there is no second hostname to set up and no cross-origin configuration.

## Requirements

- A Linux server with Docker Engine 24 or newer and the Compose plugin. 2 CPUs and 4 GB of RAM is a comfortable start; ClickHouse is the hungry one.
- A domain or subdomain pointing at the server, for example `analytics.example.com`.
- Ports 80 and 443 open. Caddy needs them to obtain certificates and serve traffic.

## Install

```bash
git clone https://github.com/webyz-org/webyz.git
cd webyz/infra
./setup.sh analytics.example.com
docker compose up -d
```

`setup.sh` writes `infra/.env` with your domain and generated database passwords. `docker compose up -d` pulls the prebuilt images, starts the databases, runs the one-shot `migrate` container (Prisma migrations, ClickHouse migrations, plan seed), then starts the API, the dashboard and Caddy. The first start takes a minute or two while ClickHouse initialises and Caddy fetches a certificate.

Then:

```bash
curl -s https://analytics.example.com/health/ready
# {"status":"ok","checks":[{"name":"postgres","ok":true,...},{"name":"clickhouse",...},{"name":"redis",...}]}
```

Open `https://analytics.example.com` and create the first account. It is the only one that can be created: `setup.sh` sets `REGISTRATION=disabled`, which allows a signup only while no account exists, so nobody who finds your domain can register. Set `REGISTRATION=open` in `.env` if you want public signups. Then add a website and paste the snippet from the setup screen into a page:

```html
<script defer src="https://analytics.example.com/js/script.js"
  data-site-id="YOUR_SITE_ID"
  data-endpoint="https://analytics.example.com/api/v1/track"></script>
```

The setup screen flips to "first event received" when the first pageview lands.

## Configure

Everything lives in `infra/.env`. `setup.sh` fills the required values; the rest are optional and empty means off. The full reference is [configuration.md](configuration.md). What matters most:

| Variable | Why you probably want it |
| --- | --- |
| `RESEND_API_KEY` and `EMAIL_FROM` | Without a mail key, password resets and usage warnings are written to the API log instead of sent, and email confirmation of new accounts is skipped (`EMAIL_VERIFICATION=auto`). With a key, new password signups must confirm their address before signing in. Fine to leave empty for a personal install; set it before other users arrive. |
| `MAXMIND_LICENSE_KEY` | A free GeoLite2 key. Without it the country, region and city breakdowns stay empty. The API downloads and refreshes the database itself. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in and the Search Console integration. Register `BASE_URL/api/v1/users/auth/google/callback` and `BASE_URL/api/v1/gsc/callback` as redirect URIs. Without them the login page has no Google button. |
| `PADDLE_*` | Only for running a paid service. Leave empty; see "Plans" below. |

After changing `.env`, apply with `docker compose up -d`.

## Update

```bash
cd webyz && git pull
cd infra
docker compose pull
docker compose up -d
```

`migrate` runs again before the API is replaced, so schema changes land first. Read `CHANGELOG.md` before upgrading; anything an operator must do by hand is under a "Breaking" heading. Roll back by checking out the previous commit and repeating. Prisma migrations are forward-only; undoing a schema change is a manual operation.

### Versions

`setup.sh` writes `IMAGE_TAG=latest`, which follows `main`. For a production install pin a release, for example `IMAGE_TAG=1.2.3` or `IMAGE_TAG=1.2` (tracks patch releases), and change it deliberately when you upgrade. Releases and their notes are on the GitHub releases page; images are tagged to match.

## Build the images yourself

Prebuilt images are published to `ghcr.io/webyz-org/webyz-api` and `webyz-app` by CI on every release, tagged `latest` and by version. To run your own changes, or if you would rather not pull from a registry:

```bash
docker compose build
docker compose up -d
```

The compose file carries both `image` and `build`, so the same commands work either way. Pin a version with `IMAGE_TAG=v1.2.3` in `.env`.

## Behind a reverse proxy you already have

Skip the bundled Caddy and publish the two services on the loopback interface for your proxy to reach:

```bash
docker compose -f docker-compose.yml -f docker-compose.expose.yml up -d
```

That puts the API on `127.0.0.1:3042` and the dashboard on `127.0.0.1:3041` (change with `API_PORT` and `APP_PORT` in `.env`). Route `/api/*`, `/js/*` and `/health*` to the API and everything else to the dashboard, terminate TLS in your proxy, and pass `X-Forwarded-For` and `X-Forwarded-Proto`. `reverse-proxy/nginx.conf.example` is a complete nginx configuration including the unbuffered realtime stream. Keep `TRUST_PROXY=1` for one proxy; set it to `2` or to your proxies' addresses if more than one sits in front.

If your proxy is itself a container, attach it to the stack's network instead of exposing ports: `docker network connect webyz_edge <your-proxy>`, then use `webyz-api:3042` and `webyz-app:8080` as upstreams.

## Operations

- **Logs**: `docker compose logs -f api`. The API logs JSON in production.
- **Health**: `/health` is liveness, `/health/ready` checks Postgres, ClickHouse and Redis. Point uptime monitoring at `/health/ready`.
- **Backups**: see "Backup and restore" below. Nothing in the stack backs up for you.
- **Jobs**: usage sync, quota enforcement, trial expiry, token purge and the geo update run inside the API process on timers with Redis locks. One API container is the expected shape.
- **Geo database**: downloaded into the `geodata` volume by the weekly `update-geo` job once `MAXMIND_LICENSE_KEY` is set. The job runs five minutes after the API starts and then every seven days, so the first breakdowns appear a few minutes after a restart with the key set.
- **Certificates**: Caddy keeps them in the `caddy_data` volume and renews automatically. Keep that volume across upgrades.

## Backup and restore

Postgres holds accounts, sites, goals, API keys and billing. ClickHouse holds the analytics. Both must be backed up; schedule this with cron or your backup tool.

```bash
cd infra
# Postgres: a consistent logical dump while running
docker compose exec -T postgres pg_dump -U webyz --clean --if-exists webyz | gzip > webyz-pg-$(date +%F).sql.gz

# ClickHouse: stop the API so nothing writes, snapshot the data volume, start again
docker compose stop api
docker run --rm -v webyz_chdata:/data:ro -v "$PWD":/backup alpine tar czf /backup/webyz-ch-$(date +%F).tar.gz -C /data .
docker compose start api
```

Restore onto a fresh install (same version) after `docker compose up -d` has created the databases:

```bash
docker compose stop api
gunzip -c webyz-pg-2026-09-08.sql.gz | docker compose exec -T postgres psql -U webyz webyz
docker compose stop clickhouse
docker run --rm -v webyz_chdata:/data -v "$PWD":/backup alpine sh -c "rm -rf /data/* && tar xzf /backup/webyz-ch-2026-09-08.tar.gz -C /data"
docker compose up -d
```

For larger installs, `clickhouse-backup` gives incremental, online backups; the volume snapshot above is the simple, always-correct method. Test a restore once before you need it.

### Postgres major version upgrade

The stack pins Postgres 16. When a future release moves to a newer major, the data directory is not compatible and Postgres will refuse to start. Upgrade by dump and restore:

```bash
cd infra
docker compose exec -T postgres pg_dump -U webyz --clean --if-exists webyz | gzip > webyz-pg-before-upgrade.sql.gz
docker compose down
docker volume rm webyz_pgdata
git pull                         # brings the new image tag
docker compose up -d postgres
gunzip -c webyz-pg-before-upgrade.sql.gz | docker compose exec -T postgres psql -U webyz webyz
docker compose up -d
```

The changelog says when this is needed; it will always be a major Webyz version.

## Customising the stack

Do not edit the committed compose files; `git pull` would conflict. Put your changes in `docker-compose.local.yml` next to them and tell Compose to load it by adding one line to `.env`:

```
COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml:docker-compose.local.yml
```

Typical uses: a different Caddy port, resource limits (`deploy.resources.limits`), an extra volume for backups, or `REGISTRATION=open`. The same mechanism selects the expose variant permanently: `COMPOSE_FILE=docker-compose.yml:docker-compose.expose.yml`.

## Troubleshooting

**Caddy has no certificate and the site does not load.** DNS for the domain must resolve to this server and ports 80 and 443 must be reachable from the internet before Caddy can pass the Let's Encrypt challenge. `docker compose logs caddy` shows the reason. A domain that only resolves internally cannot get a public certificate; use your own proxy with an internal CA instead.

**`docker compose up` stops at `migrate`.** `docker compose logs migrate` shows which step failed. A Postgres or ClickHouse that is still initialising on a slow disk can exceed the healthcheck window on first start; run `docker compose up -d` again. A password changed in `.env` after the first start does not change the database's password; either restore the old value or reset it inside the container.

**The dashboard loads but every request fails.** The dashboard calls the API on its own origin. Behind your own proxy, `/api/*`, `/js/*` and `/health*` must reach the API container; check with `curl -s https://your-domain/health/ready`.

**"First event received" never appears.** Open the page with the snippet, then the browser console with `data-debug="true"` on the script tag. `[webyz] ignoring request: localhost` means you are testing on localhost without `data-track-localhost="true"`; `DNT enabled` means the browser sends Do Not Track. A 404 from `/api/v1/track` means the site id in the snippet is wrong.

**Countries, regions and cities are empty.** Set `MAXMIND_LICENSE_KEY` and restart the API; the `update-geo` job downloads the database five minutes later. To download it right away, run `docker compose exec api node_modules/.bin/tsx scripts/update-geo.ts`. Traffic recorded before the database existed stays without geography.

**No email arrives.** Without `RESEND_API_KEY`, messages are written to the API log: `docker compose logs api | grep -i "password reset"` shows the link. With a key, the sender in `EMAIL_FROM` must be on a domain verified in Resend.

**ClickHouse uses a lot of memory.** The shipped `infra/clickhouse/*.xml` caps a single query at 2 GB and disables the internal log tables. On a machine with less than 4 GB, lower `max_memory_usage` in `users.xml` and restart the `clickhouse` service.

**Wrong client addresses in the geo breakdown or everyone rate-limited together.** `TRUST_PROXY` must equal the number of proxies in front of the API: `1` for the bundled Caddy or one proxy of your own, `2` if a CDN sits in front of that.

## Uninstall

```bash
cd infra
docker compose down -v      # stops everything and deletes the volumes, analytics included
```

Take a backup first if you might want the data back.

## Plans on a self-hosted install

The catalogue seeds Free, Starter, Growth and Business plans and every new account starts on a 30 day Growth trial, then drops to Free unless a paid subscription exists. With no Paddle keys, checkout is disabled and accounts end up on Free, whose event allowance pauses collection when reached. To lift limits for yourself, edit the free plan's `entitlements` and `event_limit` in the `plans` table, or change `apps/api/src/core/billing/catalog/plans.config.ts`, rebuild and re-run the seed. Making the free plan unlimited by default for self-hosters is on the roadmap.

## Not covered

Automated backups and restore drills, metrics and alerting beyond the health endpoints, multi-node ClickHouse, and Kubernetes manifests. Contributions on any of these are welcome.
