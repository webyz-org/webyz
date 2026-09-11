#!/usr/bin/env sh
# Run one of the Paddle operator scripts against production.
#
#   ./infra/hosted/paddle.sh probe.ts
#   ./infra/hosted/paddle.sh setup.ts --dry-run
#   ./infra/hosted/paddle.sh setup.ts --webhook https://api.webyz.io/api/v1/paddle/webhook
#   ./infra/hosted/paddle.sh sync-webhook-secret.ts
#   ./infra/hosted/paddle.sh deliveries.ts --replay-failed
#   ./infra/hosted/paddle.sh inspect.ts --email someone@example.com
#   ALLOW_LIVE=1 ./infra/hosted/paddle.sh live-test.ts discount create --code CODE
#
# The scripts need the production database and the Paddle keys, and both live
# only inside the API container's environment, so they run there: a one-off
# container from the API image, with the hosted environment file mounted so
# sync-webhook-secret.ts can write the destination's secret into it. Nothing
# here prints a secret.
set -eu
cd "$(dirname "$0")/../.."
SCRIPT="${1:?usage: paddle.sh <script.ts> [args]}"
shift
ENV_FILE="$PWD/infra/hosted/environment"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 2; }

EXTRA=""
case "$SCRIPT" in
  sync-webhook-secret.ts) EXTRA="--file /hosted/environment" ;;
esac

# --user matches the file's owner so the mounted environment file is writable
# without loosening its 600 mode; every other script only reads.
# The checkout's scripts are mounted over the image's copy, so a script change
# only needs git pull, not an image rebuild. ALLOW_LIVE is forwarded when set.
docker compose -f infra/docker-compose.yml -f infra/hosted/docker-compose.hosted.yml --env-file "$ENV_FILE" \
  run --rm --no-deps -T --user "$(id -u):$(id -g)" \
  ${ALLOW_LIVE:+-e ALLOW_LIVE="$ALLOW_LIVE"} \
  -v "$ENV_FILE:/hosted/environment" \
  -v "$PWD/apps/api/scripts:/repo/apps/api/scripts:ro" \
  api node_modules/.bin/tsx "scripts/paddle/$SCRIPT" "$@" $EXTRA
