#!/usr/bin/env sh
# Back up the hosted Webyz databases. Online: nothing is stopped, no event is
# lost while it runs.
#
#   ./infra/hosted/backup.sh                 # Postgres dump + ClickHouse backup
#   ./infra/hosted/backup.sh --postgres      # Postgres only (deploy.sh runs this before migrating)
#   ./infra/hosted/backup.sh --tag predeploy # name the files <tag> instead of nightly
#   ./infra/hosted/backup.sh --list          # what exists, with an integrity check
#
# Postgres holds accounts, sites, subscriptions, the usage ledger and the
# overage charging checkpoints: the money path. It is dumped with pg_dump
# inside the postgres container (plain SQL, gzipped). ClickHouse holds the
# analytics and is snapshotted with its own BACKUP DATABASE onto the
# `backups` disk (infra/hosted/clickhouse/backups.xml), then copied out.
#
# Files land in BACKUP_DIR as
#   webyz-pg-<tag>-<UTC stamp>.sql.gz
#   webyz-ch-<tag>-<UTC stamp>.zip
# and anything older than BACKUP_KEEP_DAYS is deleted. If BACKUP_REMOTE names
# an rclone remote (for example `b2:webyz-backups`) and rclone is installed,
# the directory is copied there afterwards; without it the backups sit on the
# same host as the databases, which protects against a bad migration or a
# mistaken delete but not against losing the machine.
#
# All three settings are read from infra/hosted/environment (BACKUP_DIR,
# BACKUP_KEEP_DAYS, BACKUP_REMOTE); the file is never sourced, because it
# holds secrets and unquoted values. Nothing here prints a secret: the
# ClickHouse password is read by clickhouse-client from the container's own
# environment.
#
# Nightly, as the deploying user (see README "Backups"):
#   0 3 * * * cd ~/apps/webyz && ./infra/hosted/backup.sh >> ~/backups/webyz/backup.log 2>&1
set -eu
cd "$(dirname "$0")/../.."
ENV_FILE=infra/hosted/environment
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 2; }

# Read one KEY=value from the environment file without sourcing it.
setting() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- ; }

BACKUP_DIR="$(setting BACKUP_DIR)"; BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/webyz}"
KEEP_DAYS="$(setting BACKUP_KEEP_DAYS)"; KEEP_DAYS="${KEEP_DAYS:-14}"
REMOTE="$(setting BACKUP_REMOTE)"

COMPOSE="docker compose -f infra/docker-compose.yml -f infra/hosted/docker-compose.hosted.yml --env-file $ENV_FILE"

MODE=full
TAG=nightly
while [ $# -gt 0 ]; do
  case "$1" in
    --postgres) MODE=postgres ;;
    --list) MODE=list ;;
    --tag) TAG="${2:?--tag needs a value}"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

log() { echo "$(date -u +%FT%TZ) $*"; }

running() { $COMPOSE ps --status running --services 2>/dev/null | grep -qx "$1"; }

if [ "$MODE" = list ]; then
  [ -d "$BACKUP_DIR" ] || { echo "no backups yet: $BACKUP_DIR does not exist"; exit 0; }
  echo "backups in $BACKUP_DIR (keep $KEEP_DAYS days${REMOTE:+, copied to $REMOTE}):"
  status=0
  for f in "$BACKUP_DIR"/webyz-*; do
    [ -e "$f" ] || { echo "  (none)"; break; }
    size=$(du -h "$f" | cut -f1)
    case "$f" in
      *.sql.gz) if gzip -t "$f" 2>/dev/null; then ok=ok; else ok=CORRUPT; status=1; fi ;;
      *.zip)
        if ! [ -s "$f" ]; then ok=EMPTY; status=1
        elif command -v unzip >/dev/null 2>&1; then
          if unzip -tqq "$f" >/dev/null 2>&1; then ok=ok; else ok=CORRUPT; status=1; fi
        else ok="size-only"; fi ;;
      *) ok="?" ;;
    esac
    printf '  %-8s %6s  %s\n' "$ok" "$size" "$(basename "$f")"
  done
  exit $status
fi

mkdir -p "$BACKUP_DIR" || { echo "cannot create BACKUP_DIR $BACKUP_DIR" >&2; exit 2; }
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
failed=0

# Postgres: logical dump over the container's local socket; --clean lets the
# file restore over an already-migrated database. A pipeline's status is
# gzip's, not pg_dump's, and an empty stream gzips into a valid file, so
# pg_dump's own exit code is captured and the dump's closing marker checked:
# without that a failed dump looks like a good 4 KB backup.
if running postgres; then
  PG_OUT="$BACKUP_DIR/webyz-pg-$TAG-$STAMP.sql.gz"
  PG_STATUS="$BACKUP_DIR/.pg_dump.status"
  { set +e; $COMPOSE exec -T postgres pg_dump -U webyz --clean --if-exists webyz; echo $? > "$PG_STATUS"; } | gzip > "$PG_OUT"
  if [ "$(cat "$PG_STATUS" 2>/dev/null)" = 0 ] && gzip -t "$PG_OUT" \
     && gunzip -c "$PG_OUT" | tail -c 300 | grep -q "PostgreSQL database dump complete"; then
    log "postgres  $(du -h "$PG_OUT" | cut -f1)  $(basename "$PG_OUT")"
  else
    rm -f "$PG_OUT"; log "postgres  FAILED: pg_dump exit $(cat "$PG_STATUS" 2>/dev/null || echo '?')"; failed=1
  fi
  rm -f "$PG_STATUS"
else
  log "postgres  skipped: container not running"
fi

# ClickHouse: BACKUP DATABASE is consistent and online. The archive is written
# to the `backups` disk (the chbackups volume), copied out, then removed so the
# volume never accumulates. The copy briefly needs the archive's size twice.
if [ "$MODE" = full ]; then
  if running clickhouse; then
    CH_NAME="webyz-ch-$TAG-$STAMP.zip"
    CH_OUT="$BACKUP_DIR/$CH_NAME"
    result=$($COMPOSE exec -T clickhouse sh -c \
      "clickhouse-client --password \"\$CLICKHOUSE_PASSWORD\" --format TSV -q \"BACKUP DATABASE webyz_analytics TO Disk('backups', '$CH_NAME')\"" 2>&1) || true
    case "$result" in
      *BACKUP_CREATED*)
        if $COMPOSE cp "clickhouse:/backups/$CH_NAME" "$CH_OUT" >/dev/null 2>&1 && [ -s "$CH_OUT" ]; then
          log "clickhouse $(du -h "$CH_OUT" | cut -f1)  $CH_NAME"
        else
          rm -f "$CH_OUT"; log "clickhouse FAILED: copy out of the container"; failed=1
        fi
        $COMPOSE exec -T clickhouse rm -f "/backups/$CH_NAME" || log "clickhouse WARN: could not remove /backups/$CH_NAME from the volume"
        ;;
      *)
        # clickhouse-client's error text names the table and the reason, never the password.
        log "clickhouse FAILED: $(printf '%s' "$result" | head -n 3 | tr '\n' ' ')"; failed=1
        ;;
    esac
  else
    log "clickhouse skipped: container not running"
  fi
fi

# Retention, on this host.
find "$BACKUP_DIR" -maxdepth 1 -name 'webyz-*' -type f -mtime +"$KEEP_DAYS" -print -delete | sed 's/^/deleted expired: /' || true

# Off-host copy, then the same retention on the remote.
if [ -n "$REMOTE" ]; then
  if command -v rclone >/dev/null 2>&1; then
    if rclone copy --include 'webyz-*' "$BACKUP_DIR" "$REMOTE" \
       && rclone delete --min-age "${KEEP_DAYS}d" --include 'webyz-*' "$REMOTE"; then
      log "remote    copied to $REMOTE"
    else
      log "remote    FAILED: rclone copy to $REMOTE"; failed=1
    fi
  else
    log "remote    FAILED: BACKUP_REMOTE is set but rclone is not installed"; failed=1
  fi
else
  log "remote    none: BACKUP_REMOTE is empty, backups exist only on this host"
fi

[ "$failed" -eq 0 ] && log "done" || { log "done WITH FAILURES"; exit 1; }
