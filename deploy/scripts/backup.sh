#!/usr/bin/env bash
# Verified database backup. Prints the backup path on success; exits non-zero on any failure.
#   ./scripts/backup.sh
# Writes BACKUP_DIR/kirana-<UTC timestamp>.dump (pg_dump custom format) + .sha256, then verifies the
# archive is readable and contains the core tables. Dumps older than KEEP_DAYS are removed, but
# never the newest KEEP_MIN. Copy backups off the VPS too (see docs/deployment.md).
# File operations run inside the db container, as the postgres user that owns BACKUP_DIR.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

BACKUP_DIR=${BACKUP_DIR:-/var/backups/kirana}
KEEP_DAYS=${KEEP_DAYS:-14}
KEEP_MIN=${KEEP_MIN:-7}
name="kirana-$(date -u +%Y%m%dT%H%M%SZ).dump"

in_db() { docker compose exec -T -u postgres db sh -ec "$1"; }

docker compose exec -T -u postgres db \
  pg_dump -U postgres -d kirana --format=custom --compress=6 -f "/backups/$name"

# Verify: the table of contents is readable and lists the data of the core tables.
toc=$(docker compose exec -T -u postgres db pg_restore --list "/backups/$name")
for table in Store Product Sale SaleItem SalePayment InventoryMovement AuditLog; do
  if ! grep -q "TABLE DATA public $table " <<<"$toc"; then
    echo "backup verification failed: table $table missing from $name" >&2
    exit 1
  fi
done
size=$(in_db "stat -c %s /backups/$name")
if [ "$size" -lt 1024 ]; then
  echo "backup verification failed: $name is only $size bytes" >&2
  exit 1
fi
in_db "cd /backups && sha256sum $name > $name.sha256"

# Retention: among dumps older than the newest KEEP_MIN, delete those older than KEEP_DAYS.
in_db "cd /backups && ls -1t kirana-*.dump | tail -n +$((KEEP_MIN + 1)) | while read -r f; do
  if [ -n \"\$(find \"\$f\" -mtime +$KEEP_DAYS)\" ]; then rm -f -- \"\$f\" \"\$f.sha256\"; fi
done"

echo "$BACKUP_DIR/$name"
