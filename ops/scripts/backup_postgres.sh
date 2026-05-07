#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

BACKUP_DIR="${BACKUP_DIR:-ops/backups/postgres}"
TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
OUTPUT_FILE="${BACKUP_DIR}/teacheros_${TIMESTAMP}.dump"

mkdir -p "${BACKUP_DIR}"

echo "Creating Postgres backup: ${OUTPUT_FILE}"
pg_dump --format=custom --no-owner --file="${OUTPUT_FILE}" "${DATABASE_URL}"
echo "Backup complete: ${OUTPUT_FILE}"
