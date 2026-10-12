#!/usr/bin/env bash
# Daily backup of LastSize: the database and all product photos.
# Kept on this machine for BACKUP_KEEP_DAYS days and, if BACKUP_REMOTE is set, copied off it:
# a home server can fail, burn or be stolen, so a copy elsewhere is what makes it a backup.
# Run from cron, e.g.:  15 3 * * *  /opt/lastsize/deploy/backup.sh >> /var/log/lastsize-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
set -a
# shellcheck disable=SC1091
. ./.env
set +a

DIR="${BACKUP_DIR:-/var/backups/lastsize}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M)"
RCLONE_IMAGE=rclone/rclone:1.75.1
NETWORK="${COMPOSE_PROJECT_NAME:-lastsize}_default"
umask 077
mkdir -p "$DIR/db" "$DIR/photos"
echo "[$(date "+%F %T")] backup started"

# Database: a consistent snapshot in pg_dump's compressed custom format (any table can be
# restored on its own). Written under a temporary name so a half-written file never looks done.
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=9 \
  > "$DIR/db/lastsize-$STAMP.dump.partial"
mv "$DIR/db/lastsize-$STAMP.dump.partial" "$DIR/db/lastsize-$STAMP.dump"
find "$DIR/db" -name 'lastsize-*.dump' -mtime +"$KEEP" -delete

# Photos (originals and processed sizes), object by object through the S3 API. Photos never
# change, so each run copies only new ones; "copy" never deletes, so a mistake upstream cannot
# wipe the backup. Credentials go through a private file, not the command line.
ENV_FILE="$(mktemp)"
trap 'rm -f "$ENV_FILE"' EXIT
cat > "$ENV_FILE" <<CONF
RCLONE_CONFIG_SRC_TYPE=s3
RCLONE_CONFIG_SRC_PROVIDER=SeaweedFS
RCLONE_CONFIG_SRC_ENDPOINT=http://storage:9000
RCLONE_CONFIG_SRC_ACCESS_KEY_ID=$S3_ACCESS_KEY
RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY=$S3_SECRET_KEY
CONF
docker run --rm --network "$NETWORK" --env-file "$ENV_FILE" -v "$DIR/photos:/backup" \
  "$RCLONE_IMAGE" copy src: /backup --fast-list --quiet

# Off-site copy. Set up the remote once with:
#   docker run --rm -it -v /root/.config/rclone:/config/rclone rclone/rclone:1.75.1 config
if [ -n "${BACKUP_REMOTE:-}" ]; then
  docker run --rm -v /root/.config/rclone:/config/rclone:ro -v "$DIR:/backup:ro" \
    "$RCLONE_IMAGE" copy /backup "$BACKUP_REMOTE" --quiet
  echo "[$(date "+%F %T")] copied to $BACKUP_REMOTE"
fi

echo "[$(date "+%F %T")] backup done: $(du -sh "$DIR/db/lastsize-$STAMP.dump" | cut -f1) database, $(du -sh "$DIR/photos" | cut -f1) photos"
