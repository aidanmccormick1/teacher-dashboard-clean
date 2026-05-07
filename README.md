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
