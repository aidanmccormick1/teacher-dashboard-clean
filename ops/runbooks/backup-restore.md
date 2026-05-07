# Backup and Restore Runbook

## Scope

- Postgres system of record (Neon, US-East)
- S3 materials bucket (`us-east-1`)

## Prerequisites

- `pg_dump`, `pg_restore`, and `aws` CLI installed.
- Environment variables exported:
  - `DATABASE_URL`
  - `S3_BUCKET`
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`
  - `AWS_DEFAULT_REGION=us-east-1`

## Create Backups

1. Postgres:
   - `bash ops/scripts/backup_postgres.sh`
2. S3 materials:
   - `bash ops/scripts/backup_s3_materials.sh`

Both scripts print the artifact location when complete.

## Restore Backups

1. Restore Postgres:
   - `bash ops/scripts/restore_postgres.sh <path-to-dump-file>`
2. Restore S3 materials:
   - `bash ops/scripts/restore_s3_materials.sh <path-to-local-materials-folder>`

## Validation After Restore

1. Run health checks:
   - `curl -fsS "$API_URL/health/liveness"`
   - `curl -fsS "$API_URL/health/readiness"`
2. Spot-check key entities:
   - onboarding user exists
   - at least one course/unit/lesson tree loads in `/v1/courses/:courseId`
3. Validate object access by generating one signed upload URL and performing a test upload.
