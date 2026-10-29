#!/bin/sh
# Runs once, when the official postgres image initialises an empty data volume.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner_password="$KIRANA_OWNER_PASSWORD" \
  -v app_password="$KIRANA_APP_PASSWORD" \
  -v dbname="$POSTGRES_DB" \
  -f /kirana/roles.sql
