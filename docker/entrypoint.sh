#!/bin/sh
# Container entrypoint — implements the ADR-0014 deployment order for the
# co-newbiz web container: backup the database BEFORE any migration can run,
# then exec the server (boot applies pending migrations via instrumentation).
set -eu

DB_PATH="${CO_NEWBIZ_DB_PATH:-/repo/db/data/co-newbiz.sqlite}"
BACKUP_DIR="${CO_NEWBIZ_BACKUP_DIR:-/backups}"

# The server is not running yet, so the SQLite file plus its WAL/SHM
# sidecars are quiescent — a plain copy is a consistent snapshot.
if [ -f "$DB_PATH" ]; then
  stamp="$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP_DIR"
  cp "$DB_PATH" "$BACKUP_DIR/pre-deploy-$stamp.db"
  if [ -f "$DB_PATH-wal" ]; then
    cp "$DB_PATH-wal" "$BACKUP_DIR/pre-deploy-$stamp.db-wal"
  fi
  if [ -f "$DB_PATH-shm" ]; then
    cp "$DB_PATH-shm" "$BACKUP_DIR/pre-deploy-$stamp.db-shm"
  fi
  echo "[entrypoint] pre-deploy backup: $BACKUP_DIR/pre-deploy-$stamp.db"
fi

exec "$@"
