#!/usr/bin/env bash
# Deploy (or update) the stack on the VPS, in this order and stopping at the first failure:
#   1. configuration present   2. images built   3. verified backup (if the database has data)
#   4. migrations (schema owner)   5. grants   6. API + web started   7. health checked over HTTPS
#   RELEASE=2026-10-29a ./scripts/deploy.sh
# Migrations are forward-only: to undo one, restore the backup taken in step 3 (restore.sh --live).
set -euo pipefail
cd "$(dirname "$0")/.."

for f in .env api.env; do
  [ -f "$f" ] || { echo "missing deploy/$f (copy $f.example and fill it in)" >&2; exit 1; }
done
set -a; . ./.env; set +a
export RELEASE=${RELEASE:-$(date -u +%Y%m%d%H%M)}
echo "== release $RELEASE"

echo "== build images"
docker compose build api web

echo "== database"
docker compose up -d db
for _ in $(seq 1 30); do
  [ "$(docker compose ps -q db | xargs docker inspect -f '{{.State.Health.Status}}')" = healthy ] && break
  sleep 2
done
has_data=$(docker compose exec -T db psql -U postgres -d kirana -At -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='_prisma_migrations'")
if [ "$has_data" = "1" ]; then
  echo "== backup before migrating"
  backup=$(./scripts/backup.sh) || { echo "backup failed: not migrating" >&2; exit 1; }
  echo "verified backup: $backup"
else
  echo "== empty database (first deploy): nothing to back up"
fi

echo "== migrate"
docker compose --profile migrate run --rm migrate
docker compose exec -T db psql -U postgres -d kirana -v ON_ERROR_STOP=1 -q -f /kirana/grants.sql

echo "== start"
docker compose up -d api web

echo "== health"
for _ in $(seq 1 60); do
  if curl -fsS --max-time 5 "https://$DOMAIN/api/v1/health/ready" >/dev/null 2>&1; then
    echo "healthy: https://$DOMAIN/api/v1/health/ready"
    curl -fsS -o /dev/null -w "web: HTTP %{http_code} https://$DOMAIN/\n" "https://$DOMAIN/"
    docker compose ps
    exit 0
  fi
  sleep 5
done
echo "not healthy after 5 minutes; recent logs:" >&2
docker compose logs --tail=80 api web >&2
exit 1
