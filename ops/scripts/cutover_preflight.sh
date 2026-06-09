#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-}"
WEB_URL="${WEB_URL:-}"
REPORT_DIR="${REPORT_DIR:-ops/reports}"
TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
REPORT_FILE="${REPORT_DIR}/cutover_preflight_${TIMESTAMP}.md"
FAILURES=0

mkdir -p "${REPORT_DIR}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib_s3_compat.sh"

{
  echo "# Cutover Preflight Report"
  echo
  echo "- Timestamp: ${TIMESTAMP}"
  echo
  echo "| Check | Result |"
  echo "| --- | --- |"
} >"${REPORT_FILE}"

record_result() {
  local label="$1"
  local result="$2"
  echo "| ${label} | ${result} |" >>"${REPORT_FILE}"
}

run_check() {
  local label="$1"
  shift

  if "$@"; then
    record_result "${label}" "PASS"
  else
    record_result "${label}" "FAIL"
    FAILURES=$((FAILURES + 1))
  fi
}

run_check "Node version available" node --version
run_check "npm version available" npm --version
run_check "Postgres tools available" pg_dump --version
run_check "Restore tool available" pg_restore --version
run_check "Migration files exist" test -n "$(ls packages/db/migrations/*.sql 2>/dev/null || true)"

run_check "API_URL configured" test -n "${API_URL}"
if [[ -n "${API_URL}" ]]; then
  run_check "API liveness check" curl -fsS "${API_URL}/health/liveness"
  run_check "API readiness check" curl -fsS "${API_URL}/health/readiness"
fi

run_check "WEB_URL configured" test -n "${WEB_URL}"
if [[ -n "${WEB_URL}" ]]; then
  run_check "Web reachable" curl -fsS "${WEB_URL}"
fi

if [[ -n "${S3_BUCKET:-}" ]]; then
  configure_s3_compat_cli
  run_check "AWS CLI available" aws --version
  run_check "S3 bucket reachable" aws "${S3_ENDPOINT_ARGS[@]}" s3 ls "s3://${S3_BUCKET}/"
else
  record_result "S3 bucket configured" "SKIP (S3_BUCKET not set)"
fi

if [[ "${FAILURES}" -gt 0 ]]; then
  echo
  echo "## Status" >>"${REPORT_FILE}"
  echo >>"${REPORT_FILE}"
  echo "FAILED (${FAILURES} checks)" >>"${REPORT_FILE}"
  echo "Preflight failed (${FAILURES} checks). See ${REPORT_FILE}" >&2
  exit 1
fi

echo >>"${REPORT_FILE}"
echo "## Status" >>"${REPORT_FILE}"
echo >>"${REPORT_FILE}"
echo "PASS" >>"${REPORT_FILE}"
echo "Preflight passed. Report: ${REPORT_FILE}"
