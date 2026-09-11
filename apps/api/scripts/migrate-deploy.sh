#!/bin/sh
# Apply every schema change and seed the plan catalogue. Run from apps/api.
#
# Calls the binaries directly instead of `pnpm run migrate:deploy` so the
# production image needs no package manager at runtime: corepack would try to
# download pnpm on first use as the unprivileged user, which fails offline.
# Locally, `pnpm run migrate:deploy` does the same three steps.
set -eu

BIN="$(dirname "$0")/../node_modules/.bin"

echo "[migrate] postgres: prisma migrate deploy"
"$BIN/prisma" migrate deploy

echo "[migrate] clickhouse: apply clickhouse/migrations"
"$BIN/tsx" "$(dirname "$0")/clickhouse/migrate.ts"

echo "[migrate] seed: plan catalogue"
"$BIN/tsx" "$(dirname "$0")/../prisma/seed.ts"

echo "[migrate] done"
