#!/usr/bin/env bash
# Proves the latest database backup can be restored: loads it into a throwaway PostgreSQL and
# counts the main tables. Run it after setting up backups, and then once a month.
set -euo pipefail
cd "$(dirname "$0")"
set -a
# shellcheck disable=SC1091
. ./.env
set +a

DIR="${BACKUP_DIR:-/var/backups/lastsize}"
LATEST="$(ls -1t "$DIR"/db/lastsize-*.dump | head -1)"
NAME="lastsize-restore-check-$$"
echo "Checking $LATEST"

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=check -e POSTGRES_DB=check postgres:18-alpine > /dev/null
trap 'docker rm -f "$NAME" > /dev/null' EXIT
for _ in $(seq 1 30); do
  docker exec "$NAME" pg_isready -U postgres -d check > /dev/null 2>&1 && break
  sleep 1
done
docker exec -i "$NAME" pg_restore -U postgres -d check --no-owner --exit-on-error < "$LATEST"
docker exec "$NAME" psql -U postgres -d check -At -c "
  SELECT 'stores: '   || count(*) FROM stores
  UNION ALL SELECT 'products: ' || count(*) FROM products
  UNION ALL SELECT 'orders: '   || count(*) FROM orders
  UNION ALL SELECT 'users: '    || count(*) FROM users;"
echo "Restore OK"
