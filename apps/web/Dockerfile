# Webyz marketing site: Next.js standalone server. Build from the repo root:
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://www.example.com \
#     --build-arg NEXT_PUBLIC_APP_URL=https://app.example.com \
#     --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.com \
#     -t webyz-web .
#
# NEXT_PUBLIC_* values are inlined at build time. The pricing page also reads
# NEXT_PUBLIC_API_BASE_URL at request time on the server to fetch the plan list,
# so the API must be reachable from this container at that public URL.
#
# The three origins are required: the code falls back to localhost for local
# development, and an image built without them shipped a sitemap, canonical
# and Open Graph URLs pointing at http://localhost:3040 (10 Sep 2026). The
# build refuses to continue rather than repeat that.

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.28.2

FROM node:${NODE_VERSION}-bookworm-slim AS build
ARG PNPM_VERSION
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_GITHUB_URL
RUN check() { case "$2" in http://*|https://*) ;; *) echo "build-arg $1 must be an absolute origin, got '$2'; see the header of apps/web/Dockerfile" >&2; exit 1 ;; esac; } \
 && check NEXT_PUBLIC_SITE_URL "$NEXT_PUBLIC_SITE_URL" \
 && check NEXT_PUBLIC_APP_URL "$NEXT_PUBLIC_APP_URL" \
 && check NEXT_PUBLIC_API_BASE_URL "$NEXT_PUBLIC_API_BASE_URL"
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    NEXT_PUBLIC_GITHUB_URL=${NEXT_PUBLIC_GITHUB_URL} \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/app/package.json apps/app/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter my-app...
COPY apps/web apps/web
# /docs/* pages are rendered from the repository's docs/ at build time.
COPY docs docs
WORKDIR /repo/apps/web
RUN pnpm build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
# Standalone output keeps the monorepo layout: the server entry lives at
# apps/web/server.js inside it, next to a pruned node_modules.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
