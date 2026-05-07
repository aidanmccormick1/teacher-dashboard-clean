#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

BACKUP_FILE="${1:-}"
if [[ -z "${BACKUP_FILE}" ]]; then
  echo "Usage: bash ops/scripts/restore_postgres.sh <backup.dump>" >&2
  exit 1
fi

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

echo "Restoring Postgres backup from ${BACKUP_FILE}"
pg_restore --clean --if-exists --no-owner --dbname="${DATABASE_URL}" "${BACKUP_FILE}"
echo "Restore complete"
