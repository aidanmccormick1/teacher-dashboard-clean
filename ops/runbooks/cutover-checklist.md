# Cutover Checklist

## Automated Preflight

Run before DNS cutover:

- `bash ops/scripts/cutover_preflight.sh`

The script writes a timestamped report to `ops/reports/`.

## Manual Go/No-Go Checklist

1. Confirm backup artifacts from the same day exist for DB and S3.
2. Confirm CI is green on `typecheck`, `lint`, `test`, `build`.
3. Confirm staging smoke tests:
   - onboarding
   - dashboard today
   - schedule import
   - curriculum CRUD
   - lesson tracker writes
   - AI queue job cancel/retry
4. Confirm alerting channels and on-call coverage are active.
5. Confirm rollback target and DNS rollback steps are documented.

## DNS Cutover

1. Reduce TTL at least 24 hours before cutover window.
2. Switch production DNS to v2 stack.
3. Monitor 60 minutes with heightened watch on:
   - API 5xx
   - readiness probes
   - AI job failures
   - frontend unhandled errors

## Rollback Criteria

Rollback immediately if any of the following are true for longer than 5 minutes:

- API 5xx > 5%
- Readiness failing continuously
- Core teacher workflow blocked (login, dashboard, schedule, classroom)
