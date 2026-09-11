# Webyz dashboard: a static Vite build served by nginx. Build from the repo root:
#   docker build -f apps/app/Dockerfile -t webyz-app .
#
# No build arguments are needed for self-hosting: the dashboard talks to the
# API on its own origin, which is how one prebuilt image serves any domain.
# The hosted product, which runs the API on a separate hostname, passes
#   --build-arg VITE_API_BASE_URL=https://api.example.com
#   --build-arg VITE_MARKETING_URL=https://example.com

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.28.2

FROM node:${NODE_VERSION}-bookworm-slim AS build
ARG PNPM_VERSION
ARG VITE_API_BASE_URL
ARG VITE_MARKETING_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} VITE_MARKETING_URL=${VITE_MARKETING_URL}
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/app/package.json apps/app/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter app...
COPY apps/app apps/app
WORKDIR /repo/apps/app
RUN pnpm build

# Unprivileged nginx: runs as uid 101, listens on 8080, writes only to /tmp.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY apps/app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /repo/apps/app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
