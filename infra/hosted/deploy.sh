#!/usr/bin/env sh
# Deploy the hosted Webyz from this checkout.
#
#   ./infra/hosted/deploy.sh             # build what changed, dump Postgres, migrate, start
#   ./infra/hosted/deploy.sh --no-build  # restart with the images already built
#   ./infra/hosted/deploy.sh --no-backup # skip the pre-migration dump (first deploy, or a hurry)
#
# A release is: git pull, then this. Compose runs the migrate role first
# (Prisma migrate deploy, ClickHouse migrations, plan seed) and the API waits
# for it, so every deploy is migrate-then-start. Migrations are forward-only
# and the databases are never rolled back, so Postgres is dumped just before
# `up` (backup.sh --postgres --tag predeploy): a bad migration is undone by
# restoring that file and checking out the previous commit. ClickHouse is not
# dumped here (too large for every deploy); its migrations only add.
set -eu
cd "$(dirname "$0")/../.."
ENV_FILE=infra/hosted/environment
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE; copy infra/hosted/environment.example and fill it in" >&2; exit 2; }
docker network inspect proxy >/dev/null 2>&1 || { echo "the shared 'proxy' network does not exist; is nginx-proxy running?" >&2; exit 2; }

COMPOSE="docker compose -f infra/docker-compose.yml -f infra/hosted/docker-compose.hosted.yml --env-file $ENV_FILE"

BUILD=1
BACKUP=1
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --no-backup) BACKUP=0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [ "$BUILD" -eq 1 ]; then
  echo "building images from $(git rev-parse --short HEAD)"
  $COMPOSE build --pull
fi

if [ "$BACKUP" -eq 1 ]; then
  echo "dumping Postgres before migrating"
  ./infra/hosted/backup.sh --postgres --tag predeploy
fi

echo "starting (migrate runs first)"
$COMPOSE up -d --remove-orphans

echo "waiting for the API"
for i in $(seq 1 30); do
  # The API image is Debian-slim with no curl or wget; Node's fetch is there.
  if docker exec webyz-api node -e "fetch('http://127.0.0.1:3042/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    echo "api ready"
    break
  fi
  [ "$i" -eq 30 ] && { echo "api not ready after 60s; docker compose logs api" >&2; $COMPOSE ps; exit 1; }
  sleep 2
done

$COMPOSE ps
echo "deployed $(git rev-parse --short HEAD)"
