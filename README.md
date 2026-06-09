# TeacherOS v2 Monorepo

This repository contains the v2 rebuild of the Teacher Platform with an API-first architecture.

## Workspace layout

- `apps/web`: React + Vite SPA (Cloudflare Pages target)
- `apps/api`: Fastify TypeScript API (Render target)
- `apps/worker`: optional standalone BullMQ process for async AI jobs
- `packages/ai-worker`: shared queued-job processor used by the API pilot mode and standalone worker
- `packages/db`: Drizzle schema + migrations for Neon Postgres
- `packages/contracts`: Shared Zod contracts for request/response types

Legacy v1 files remain in the repository as reference during migration.

## Local setup

1. Copy `.env.example` to `.env` and fill values.
2. Install dependencies:
   - `npm install`
3. Start all services:
   - `npm run dev`

## Quality gates

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run build`

## Production smoke checks

Run the public health and SPA checks:

- `npm run ops:smoke:production`

Add the pilot token to verify authenticated teacher reads:

- `PILOT_TOKEN=... npm run ops:smoke:production`

After the private R2/S3-compatible bucket is configured, verify the full queued reader and signed-upload paths:

- `PILOT_TOKEN=... REQUIRE_AI_CAPABILITIES=1 SMOKE_AI_QUEUE=1 SMOKE_S3_UPLOAD=1 npm run ops:smoke:production`

The checked-in `render.yaml` provisions the API, Redis-compatible key-value store, and Postgres in Render's Ohio US-East region. The free pilot runs the BullMQ processor inside the API process. A standalone `apps/worker` process remains available for a paid production worker later. Cloudflare R2 is the free pilot object-storage target; see `infra/cloudflare-r2.md`. Storage and API keys remain private dashboard variables.
