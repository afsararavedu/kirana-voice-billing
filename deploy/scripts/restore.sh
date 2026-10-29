#!/usr/bin/env bash
# Restore a backup made by backup.sh.
#
#   ./scripts/restore.sh --drill /var/backups/kirana/kirana-<ts>.dump
#       Restores into a scratch database (kirana_restore_drill), checks it, prints row counts and
#       the sales total, then drops the scratch database. The live database is not touched.
#
#   CONFIRM=replace-live-database ./scripts/restore.sh --live /var/backups/kirana/kirana-<ts>.dump
#       Replaces the live database with the backup: takes a fresh safety backup first, stops the
#       API, recreates the database, restores, re-applies grants, starts the API. Destructive —
#       everything since the backup is lost. Only after reading docs/deployment.md.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

mode=${1:-}
file=${2:-}
if [ -z "$mode" ] || [ -z "$file" ] || [ ! -f "$file" ]; then
  echo "usage: $0 --drill|--live <backup.dump>" >&2
  exit 2
fi
BACKUP_DIR=${BACKUP_DIR:-/var/backups/kirana}
case "$(cd "$(dirname "$file")" && pwd)" in
  "$(cd "$BACKUP_DIR" && pwd)") ;;
  *) echo "backup must be inside $BACKUP_DIR (mounted into the db container)" >&2; exit 2 ;;
esac
name=$(basename "$file")

if [ -f "$file.sha256" ]; then
  docker compose exec -T -u postgres db sh -ec "cd /backups && sha256sum -c --quiet $name.sha256" \
    || { echo "checksum mismatch: $name" >&2; exit 1; }
else
  echo "warning: no checksum file for $name" >&2
fi

psql_db() { docker compose exec -T -u postgres db psql -U postgres -v ON_ERROR_STOP=1 -At "$@"; }

summary() {
  psql_db -d "$1" -c "SELECT
    (SELECT count(*) FROM \"Store\")            AS stores,
    (SELECT count(*) FROM \"Product\")          AS products,
    (SELECT count(*) FROM \"Sale\")             AS bills,
    (SELECT coalesce(sum(\"grandTotal\"), 0) FROM \"Sale\") AS sales_total,
    (SELECT count(*) FROM \"InventoryMovement\") AS stock_movements,
    (SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%_append_only') AS history_guards,
    (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL) AS migrations"
}

case "$mode" in
  --drill)
    drill=kirana_restore_drill
    psql_db -d postgres -c "DROP DATABASE IF EXISTS $drill"
    psql_db -d postgres -c "CREATE DATABASE $drill OWNER kirana_owner"
    docker compose exec -T -u postgres db pg_restore -U postgres -d "$drill" --exit-on-error "/backups/$name"
    echo "restored copy (stores|products|bills|sales_total|stock_movements|history_guards|migrations):"
    summary "$drill"
    echo "live database, for comparison:"
    summary kirana
    psql_db -d postgres -c "DROP DATABASE $drill"
    echo "restore drill OK: $name restores cleanly"
    ;;
  --live)
    if [ "${CONFIRM:-}" != "replace-live-database" ]; then
      echo "refusing: set CONFIRM=replace-live-database to replace the live database" >&2
      exit 2
    fi
    echo "taking a safety backup of the current database first..."
    safety=$(./scripts/backup.sh)
    echo "safety backup: $safety"
    docker compose stop api
    psql_db -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'kirana' AND pid <> pg_backend_pid()" >/dev/null
    psql_db -d postgres -c "DROP DATABASE kirana"
    psql_db -d postgres -c "CREATE DATABASE kirana OWNER postgres"
    psql_db -d kirana -c "ALTER SCHEMA public OWNER TO kirana_owner; REVOKE ALL ON DATABASE kirana FROM PUBLIC; GRANT CONNECT, TEMPORARY, CREATE ON DATABASE kirana TO kirana_owner; GRANT CONNECT ON DATABASE kirana TO kirana_app; GRANT USAGE ON SCHEMA public TO kirana_app"
    docker compose exec -T -u postgres db pg_restore -U postgres -d kirana --exit-on-error "/backups/$name"
    psql_db -d kirana -f /kirana/grants.sql
    summary kirana
    docker compose up -d api
    echo "live database restored from $name (safety backup: $safety)"
    ;;
  *)
    echo "usage: $0 --drill|--live <backup.dump>" >&2
    exit 2
    ;;
esac
