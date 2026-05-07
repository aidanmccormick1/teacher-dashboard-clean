# TeacherOS v2 Implementation Status

## What is implemented now

### Latest phase execution (production phases)

- Classroom/schedule workflow hardening:
  - Added manual class section APIs:
    - `POST /v1/sections`
    - `PATCH /v1/sections/:sectionId`
    - `DELETE /v1/sections/:sectionId`
  - Added real classroom resume API:
    - `GET /v1/sections/:sectionId/resume`
  - Replaced fake `demo-lesson` classroom navigation with real section/curriculum resume logic.
  - Lesson tracker now loads section context, resume state, lesson segments, completed segment state, stopped-at segment, carry-over notes, and last class note.
  - Added ownership validation to lesson progress and class note writes so one teacher cannot write another teacher's section state.
- Curriculum migration completed:
  - API CRUD endpoints added for `courses`, `units`, `lessons`, and `lesson_segments`
  - Curriculum and course detail pages now use live `/v1` APIs (no placeholder pages)
- AI job workflow hardened end-to-end:
  - queue-based job status now includes progress, attempts, cancel flags, and retry eligibility
  - new AI control routes:
    - `POST /v1/ai/jobs/:jobId/cancel`
    - `POST /v1/ai/jobs/:jobId/retry`
  - worker now honors cancel requests and persists retry/fail transitions
- Production runbook hardening added:
  - `ops/scripts/*` backup/restore and cutover preflight automation
  - `ops/runbooks/*` for backup/restore, alerts/SLO thresholds, and cutover checklist

### Foundation Sprint

- Monorepo structure created:
  - `apps/web`
  - `apps/api`
  - `apps/worker`
  - `packages/db`
  - `packages/contracts`
- Shared tooling added:
  - TypeScript
  - ESLint
  - Prettier
  - Vitest
  - GitHub Actions CI (`typecheck`, `lint`, `test`, `build`)
- Deployment scaffolding added:
  - Cloudflare Pages setup guide: `infra/cloudflare-pages.md`
  - Render blueprint: `infra/render.yaml`
- Health and readiness routes implemented:
  - `GET /health/liveness`
  - `GET /health/readiness`

### Data Sprint (initial)

- Drizzle schema and SQL migration added for normalized v2 model:
  - `users`
  - `schools`
  - `teacher_profiles`
  - `courses`
  - `sections`
  - `section_meetings`
  - `school_holidays`
  - `units`
  - `lessons`
  - `lesson_segments`
  - `section_lesson_state`
  - `class_notes`
  - `ai_jobs`
  - `ai_outputs`
  - `audit_events`
- Initial migration file: `packages/db/migrations/0000_initial.sql`

### API-first migration (core routes)

- Implemented versioned routes:
  - `POST /v1/onboarding`
  - `GET /v1/dashboard/today`
  - `GET /v1/schedule`
  - `POST /v1/sections`
  - `PATCH /v1/sections/:sectionId`
  - `DELETE /v1/sections/:sectionId`
  - `GET /v1/sections/:sectionId/resume`
  - `POST /v1/schedule/import`
  - `POST /v1/holidays`
  - `POST /v1/lesson-progress/upsert`
  - `POST /v1/class-notes/upsert`
  - `POST /v1/ai/parse-schedule`
  - `POST /v1/ai/generate-segments`
  - `POST /v1/ai/generate-continuity`
- Additional storage helper route:
  - `POST /v1/files/sign-upload`
- OpenAPI docs enabled at:
  - `/docs`

### Auth and reliability baseline

- Clerk token verification hook added for API.
- Development auth fallback supported via headers in non-production.
- Request ID propagation added via response headers.
- Centralized API error handling + Sentry hook points.
- Redis cache helper integrated for dashboard short TTL cache.

### Practical AI baseline

- AI routes migrated to OpenAI Responses API.
- Structured JSON schema validation enforced with shared contracts.
- AI job persistence implemented in `ai_jobs` + `ai_outputs`.
- Worker service scaffolded with BullMQ for asynchronous job execution path.

### Web app v2 scaffold

- New React + Vite app with route intent preserved:
  - `/login`
  - `/onboarding`
  - `/dashboard` and `/`
  - `/school`
  - `/classroom`
  - `/curriculum`
  - `/courses/:id`
  - `/schedule`
  - `/sections/:sectionId/lessons/:lessonId`
  - `/profile`
- Web now calls API routes through a typed API client (`/v1/...`), not direct DB access.

## Verification status

- `npm run typecheck` passes
- `npm run lint` passes (with one non-blocking React hooks warning)
- `npm run test` passes
- `npm run build` passes

## Remaining work to complete full plan

- Expand classroom + lesson tracker UX to full parity with section-specific states and segment interactions.
- Implement full repository/service layering in API modules (currently routes contain direct orchestration).
- Add contract and integration tests for each business route (currently smoke-level baseline).
- Add full e2e scenarios for all acceptance criteria in the plan.
- Complete DNS cutover + production runbooks/backup verification.
