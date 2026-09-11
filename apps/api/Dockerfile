# Webyz API. Build from the repo root:
#   docker build -f apps/api/Dockerfile -t webyz-api .
#
# One image serves three roles, selected by the command:
#   default            node dist/server.js              the API
#   migrate            sh scripts/migrate-deploy.sh     Postgres + ClickHouse migrations, plan seed
#   worker             node dist/worker.js              Kafka consumer (only if KAFKA_ENABLED)
#
# No package manager in the runtime image: the migrate role calls the prisma
# and tsx binaries from node_modules/.bin directly.
#
# glibc base rather than alpine: bcrypt and the Prisma toolchain ship glibc
# binaries and this avoids a native rebuild at every install.

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.28.2

# ─── deps: the whole workspace's manifests, backend's dependencies only ───────
FROM node:${NODE_VERSION}-bookworm-slim AS deps
ARG PNPM_VERSION
# openssl must be present when @prisma/engines runs its install script: it
# detects the libssl version and downloads the matching schema engine. Without
# it the 1.1.x engine is fetched, and at runtime Prisma tries to download the
# 3.0.x one into a read-only node_modules and migrate fails.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/app/package.json apps/app/
COPY apps/web/package.json apps/web/
# Dev dependencies stay: prisma and tsx run the migrations in this same image.
RUN pnpm install --frozen-lockfile --filter backend...

# ─── build: generate the Prisma client, compile ─────────────────────────────
FROM deps AS build
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/
COPY apps/api/src apps/api/src
WORKDIR /repo/apps/api
# prisma generate needs a DATABASE_URL to parse the config; the value is not used.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm prisma:generate \
 && pnpm build

# ─── runtime ────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*
# CHECKPOINT_DISABLE stops the Prisma CLI phoning home for version checks on
# every migrate run.
ENV NODE_ENV=production CHECKPOINT_DISABLE=1
WORKDIR /repo

# The pnpm layout is symlinks into /repo/node_modules/.pnpm, so both trees are
# copied at the same relative paths.
COPY --from=deps /repo/package.json /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml ./
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
# The seed and the ClickHouse migrator run from TypeScript through tsx and
# import from src (the plan catalogue, the generated Prisma client), so the
# source tree ships alongside dist. It is small and the code is public anyway.
COPY --from=build /repo/apps/api/src ./apps/api/src
COPY apps/api/package.json apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma apps/api/prisma
COPY apps/api/clickhouse apps/api/clickhouse
# All operator scripts, not only the migrator: the Paddle provisioning, probe,
# deliveries, inspection and reconciliation scripts run inside this image in
# production, because it is the one place that has the database and the keys.
COPY apps/api/scripts apps/api/scripts
COPY apps/api/public apps/api/public

WORKDIR /repo/apps/api
# geo/ holds the MaxMind database the update-geo job downloads; mount a volume.
RUN mkdir -p geo && chown -R node:node /repo/apps/api/geo
USER node

EXPOSE 3042
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3042/health || exit 1

CMD ["node", "dist/server.js"]
