# Developing Webyz

## Requirements

Node 22 or newer, pnpm 10 (the repo pins the exact version through `packageManager`; `corepack enable` picks it up), Docker for the databases.

## Run it locally

```bash
git clone https://github.com/webyz-org/webyz.git && cd webyz
pnpm install
docker compose up -d                 # postgres 5442, clickhouse 8123, redis 6382
```

Create the three env files. The variable names are documented in [configuration.md](configuration.md); the local values are:

```
# apps/api/.env
DATABASE_URL=postgresql://postgres:password@localhost:5442/webyz
CLICKHOUSE_URL=http://localhost:8123
REDIS_HOST=127.0.0.1
REDIS_PORT=6382
FRONTEND_URL=http://localhost:3041
MARKETING_URL=http://localhost:3040

# apps/app/.env
VITE_API_BASE_URL=http://localhost:3042
VITE_MARKETING_URL=http://localhost:3040

# apps/web/.env
NEXT_PUBLIC_APP_URL=http://localhost:3041
NEXT_PUBLIC_API_BASE_URL=http://localhost:3042
```

Then apply the schema and start everything:

```bash
cd apps/api
pnpm prisma:generate
pnpm run migrate:deploy              # Prisma migrations, ClickHouse migrations, plan seed
cd ../..
pnpm dev                             # api :3042, dashboard :3041, marketing :3040
```

Open `http://localhost:3041`, sign up, add a site, and use `examples/tracker/basic.html` or `data-track-localhost="true"` to send yourself events.

The host ports are deliberately not the defaults (5432, 6379, 9000 are often taken by other projects). Keep `apps/api/.env` in sync with `docker-compose.yml` if you change them.

## Commands

From the repo root, Turborepo fans out to every workspace:

```bash
pnpm dev            # all apps
pnpm build
pnpm lint
pnpm typecheck
```

In `apps/api`:

```bash
pnpm test                            # unit tests
RUN_DB_TESTS=1 pnpm test             # plus the database tests, against DATABASE_URL
pnpm prisma:migrate                  # create a migration from schema changes (dev)
pnpm prisma:generate                 # regenerate the client into src/generated
pnpm clickhouse:migrate              # apply clickhouse/migrations in filename order
pnpm prisma:seed                     # upsert the plan catalogue
```

Tests use Node's built-in runner. Files sit next to the code as `*.test.ts`; database-backed ones end in `.db.test.ts` and skip themselves unless `RUN_DB_TESTS=1` is set. Billing and usage code must have tests. Most other areas do not yet; do not claim a change there is tested unless you added one.

## Project layout

```
apps/api      Fastify API: routes -> controllers -> core/<domain> services -> db/clickhouse or Prisma
apps/app      Dashboard, Vite + React 19, feature folders under src/features
apps/web      Marketing site and legal pages, Next.js
infra         Production compose stack, Caddy and nginx examples
docs          What you are reading
examples      Static pages that load the tracker for manual testing
```

`CLAUDE.md` at the root is the detailed engineering reference: architecture, conventions, gotchas, and the reasoning behind non-obvious decisions. It is kept accurate and is the first thing to read before changing anything in billing, ingest or the data model.

## Conventions worth knowing

- The API is layered one way only. Routes parse, controllers normalise and call a service, services compute and talk to ClickHouse or Prisma. Raw SQL lives only in `apps/api/src/db/clickhouse` and is always parameterised.
- Expected failures are created with `createAppError` and get a stable `code`; a raw `Error` becomes a 500.
- Postgres columns are snake_case with `@map`. Never edit an applied migration; add a new one. ClickHouse migrations are numbered SQL files, applied in order and recorded.
- The `sessions` table is a `ReplacingMergeTree`; queries deduplicate with `FINAL` or `argMax`, and the session writer carries every column forward.
- Time ranges cross the wire as Unix seconds with an exclusive `to`, computed in each site's own timezone.
- The dashboard trusts the API for entitlements; the API is the enforcement point.

## Releasing

1. Move the `Unreleased` section of `CHANGELOG.md` under a new version heading with the date, keeping a `Breaking` subsection if operators must act.
2. Tag and push: `git tag v1.2.3 && git push origin v1.2.3`.
3. CI builds the API and dashboard images for amd64 and arm64 and pushes them to GitHub Container Registry as `1.2.3`, `1.2` and `latest`. The first time, make the two packages public in the GitHub package settings so self-hosters can pull them without a token.
4. Create the GitHub release from the tag and paste the changelog section.

## Making a change

Branch from `main`, keep the change focused, run `pnpm lint`, `pnpm typecheck` and the tests, update `CLAUDE.md` if you changed something it describes, and open a pull request. CI runs the same checks against fresh Postgres, ClickHouse and Redis containers and builds the three Docker images. See [CONTRIBUTING.md](../CONTRIBUTING.md).
