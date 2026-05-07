#!/usr/bin/env bash
set -euo pipefail

: "${S3_BUCKET:?S3_BUCKET is required}"

SOURCE_DIR="${1:-}"
if [[ -z "${SOURCE_DIR}" ]]; then
  echo "Usage: bash ops/scripts/restore_s3_materials.sh <local-materials-folder>" >&2
  exit 1
fi

if [[ ! -d "${SOURCE_DIR}" ]]; then
  echo "Source directory not found: ${SOURCE_DIR}" >&2
  exit 1
fi

S3_PREFIX="${S3_PREFIX:-materials/}"
DRY_RUN="${DRY_RUN:-false}"

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "Dry run enabled."
  aws s3 sync "${SOURCE_DIR}" "s3://${S3_BUCKET}/${S3_PREFIX}" --dryrun
  exit 0
fi

echo "Syncing ${SOURCE_DIR} -> s3://${S3_BUCKET}/${S3_PREFIX}"
aws s3 sync "${SOURCE_DIR}" "s3://${S3_BUCKET}/${S3_PREFIX}"
echo "S3 restore complete"
