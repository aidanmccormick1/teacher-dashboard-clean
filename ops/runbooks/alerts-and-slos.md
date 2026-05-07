# Alerts and SLO Thresholds

## API (Render, US-East)

- `p95 latency > 250ms` for `5m` on non-AI `/v1/*` routes: **warning**
- `p95 latency > 500ms` for `5m`: **critical**
- `5xx rate > 2%` for `5m`: **warning**
- `5xx rate > 5%` for `5m`: **critical**
- `/health/readiness` failing for `2` consecutive checks: **critical**

## Web (Cloudflare Pages)

- First useful render `> 1.5s` p75 on broadband synthetic probes: **warning**
- JS unhandled rejection/session error rate `> 0`: **critical** (target is zero)

## Worker / Queue

- Jobs stuck in `queued` for `> 3m`: **warning**
- Jobs stuck in `running` for `> 5m`: **critical**
- Retry exhaustion (`failed` after max attempts) rate `> 10%` over `15m`: **warning**
- Dead-letter queue size `> 0`: **critical**

## Database (Neon Postgres)

- Connection saturation `> 80%` for `10m`: **warning**
- Storage `> 85%`: **warning**
- Replication lag or write errors detected: **critical**

## Storage (S3)

- Signed URL failure rate `> 1%` over `10m`: **warning**
- Any public ACL/object exposure event: **critical**

## Escalation

1. Warning: open incident thread and assign owner within 15 minutes.
2. Critical: page on-call immediately and begin rollback decision in 5 minutes.
