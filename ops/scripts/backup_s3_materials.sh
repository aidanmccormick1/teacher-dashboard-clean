#!/usr/bin/env bash
set -euo pipefail

: "${S3_BUCKET:?S3_BUCKET is required}"

S3_PREFIX="${S3_PREFIX:-materials/}"
BACKUP_DIR="${BACKUP_DIR:-ops/backups/s3}"
TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
TARGET_DIR="${BACKUP_DIR}/materials_${TIMESTAMP}"

mkdir -p "${TARGET_DIR}"

echo "Syncing s3://${S3_BUCKET}/${S3_PREFIX} -> ${TARGET_DIR}"
aws s3 sync "s3://${S3_BUCKET}/${S3_PREFIX}" "${TARGET_DIR}"
echo "S3 backup complete: ${TARGET_DIR}"
