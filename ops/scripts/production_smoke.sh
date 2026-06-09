#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-https://teacheros-api.onrender.com}"
WEB_URL="${WEB_URL:-https://teacher-dashboard-clean.pages.dev}"
PILOT_TOKEN="${PILOT_TOKEN:-}"
SMOKE_AI_QUEUE="${SMOKE_AI_QUEUE:-0}"
SMOKE_S3_UPLOAD="${SMOKE_S3_UPLOAD:-0}"
REQUIRE_AI_CAPABILITIES="${REQUIRE_AI_CAPABILITIES:-0}"

PASS_COUNT=0

check() {
  local label="$1"
  shift
  printf 'Checking %-34s' "${label}"
  if "$@" >/dev/null; then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo " PASS"
  else
    echo " FAIL"
    exit 1
  fi
}

authenticated_get() {
  curl -fsS --max-time 30 -H "Authorization: Bearer ${PILOT_TOKEN}" "${API_URL}$1"
}

authenticated_post() {
  curl -fsS --max-time 60 \
    -H "Authorization: Bearer ${PILOT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$2" \
    "${API_URL}$1"
}

json_field() {
  node -e "
    const fs = require('node:fs');
    const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
    const value = process.argv[1].split('.').reduce((current, key) => current?.[key], payload);
    if (value === undefined || value === null) process.exit(1);
    process.stdout.write(String(value));
  " "$1"
}

check "web root" curl -fsS --max-time 30 "${WEB_URL}/"
check "web login SPA route" curl -fsS --max-time 30 "${WEB_URL}/login"
check "web management SPA route" curl -fsS --max-time 30 "${WEB_URL}/management"
check "API liveness" curl -fsS --max-time 60 "${API_URL}/health/liveness"
check "API readiness" curl -fsS --max-time 30 "${API_URL}/health/readiness"
capabilities_response="$(curl -fsS --max-time 30 "${API_URL}/health/capabilities")"
PASS_COUNT=$((PASS_COUNT + 1))
echo "Checking API capabilities                    PASS"

if [[ "${REQUIRE_AI_CAPABILITIES}" == "1" ]]; then
  redis_enabled="$(printf '%s' "${capabilities_response}" | json_field "redis")"
  queue_enabled="$(printf '%s' "${capabilities_response}" | json_field "aiQueue")"
  worker_enabled="$(printf '%s' "${capabilities_response}" | json_field "aiWorker")"
  openai_enabled="$(printf '%s' "${capabilities_response}" | json_field "openai")"
  test "${redis_enabled}" == "true"
  test "${queue_enabled}" == "true"
  test "${worker_enabled}" == "true"
  test "${openai_enabled}" == "true"
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "Checking AI runtime capabilities             PASS"
fi

if [[ -z "${PILOT_TOKEN}" ]]; then
  echo
  echo "Core public checks passed. Set PILOT_TOKEN to run authenticated smoke checks."
  exit 0
fi

check "authenticated dashboard" authenticated_get "/v1/dashboard/today"
check "authenticated schedule" authenticated_get "/v1/schedule"
check "authenticated courses" authenticated_get "/v1/courses"
check "authenticated profile" authenticated_get "/v1/profile"

if [[ "${SMOKE_S3_UPLOAD}" == "1" ]]; then
  s3_enabled="$(printf '%s' "${capabilities_response}" | json_field "s3")"
  test "${s3_enabled}" == "true"
  upload_response="$(
    authenticated_post \
      "/v1/files/sign-upload" \
      '{"fileName":"teacheros-production-smoke.txt","contentType":"text/plain"}'
  )"
  upload_url="$(printf '%s' "${upload_response}" | json_field "uploadUrl")"
  object_key="$(printf '%s' "${upload_response}" | json_field "objectKey")"
  test -n "${upload_url}"
  test -n "${object_key}"
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "Checking signed S3 upload URL                 PASS"

  upload_body="TeacherOS production smoke upload ${object_key}"
  upload_status="$(
    curl -sS -o /dev/null -w "%{http_code}" --max-time 60 \
      -X PUT \
      -H "Content-Type: text/plain" \
      --data-binary "${upload_body}" \
      "${upload_url}"
  )"
  case "${upload_status}" in
    200|201|204)
      PASS_COUNT=$((PASS_COUNT + 1))
      echo "Checking signed S3 upload PUT                 PASS"
      ;;
    *)
      echo "Checking signed S3 upload PUT                 FAIL (${upload_status})"
      exit 1
      ;;
  esac
fi

if [[ "${SMOKE_AI_QUEUE}" == "1" ]]; then
  queue_response="$(
    authenticated_post \
      "/v1/ai/parse-schedule/queue" \
      '{"text":"Period 1 US History Monday Wednesday Friday 09:00 room 204"}'
  )"
  job_id="$(printf '%s' "${queue_response}" | json_field "jobId")"
  test -n "${job_id}"
  echo "Checking queued schedule reader              QUEUED ${job_id}"

  final_status=""
  for _attempt in $(seq 1 30); do
    status_response="$(authenticated_get "/v1/ai/jobs/${job_id}")"
    final_status="$(printf '%s' "${status_response}" | json_field "status")"
    case "${final_status}" in
      succeeded)
        PASS_COUNT=$((PASS_COUNT + 1))
        echo "Checking queued schedule reader              PASS"
        break
        ;;
      failed|cancelled)
        echo "Checking queued schedule reader              FAIL (${final_status})"
        printf '%s\n' "${status_response}"
        exit 1
        ;;
    esac
    sleep 3
  done

  if [[ "${final_status}" != "succeeded" ]]; then
    echo "Checking queued schedule reader              FAIL (timed out)"
    exit 1
  fi
fi

echo
echo "Production smoke passed: ${PASS_COUNT} checks"
