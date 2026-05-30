# TeacherOS v2 Monorepo

This repository contains the v2 rebuild of the Teacher Platform with an API-first architecture.

## Workspace layout

- `apps/web`: React + Vite SPA (Cloudflare Pages target)
- `apps/api`: Fastify TypeScript API (Render target)
- `apps/worker`: BullMQ worker for async AI jobs
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

After the Render worker and private S3 bucket are configured, verify the full queued reader and signed-upload paths:

- `PILOT_TOKEN=... REQUIRE_AI_CAPABILITIES=1 SMOKE_AI_QUEUE=1 SMOKE_S3_UPLOAD=1 npm run ops:smoke:production`

The checked-in `render.yaml` provisions the API, BullMQ worker, Redis-compatible key-value store, and Postgres in Render's Ohio US-East region. S3 and API keys remain private dashboard variables.
