# Production Deployment Checklist

The current production frontend is the Git-connected Cloudflare Pages project
`teacherplat`, deployed automatically from `main`. The previous
`teacheros-app.pages.dev` address is a legacy transition address, not the
canonical URL.

## Automated Preflight

Run before a production release:

- `bash ops/scripts/cutover_preflight.sh`

The script writes a timestamped report to `ops/reports/`.

## Manual Go/No-Go Checklist

1. Confirm backup artifacts from the same day exist for DB and R2/S3 materials.
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

## Frontend Release

1. Confirm the intended commit is on `origin/main` and CI is green.
2. Confirm Cloudflare Pages deployed that commit to `teacherplat`.
3. Run the public production smoke checks.
4. Monitor 60 minutes with heightened watch on:
   - API 5xx
   - readiness probes
   - AI job failures
   - frontend unhandled errors

## Rollback Criteria

Escalate or roll back the release if any of the following are true for longer than 5 minutes:

- API 5xx > 5%
- Readiness failing continuously
- Core teacher workflow blocked (login, dashboard, schedule, classroom)
