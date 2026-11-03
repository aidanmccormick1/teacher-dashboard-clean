# TeacherDesk project and app audit

**Audit date:** 2026-11-03  
**Repository:** teacher-dashboard-clean  
**Audited checkout:** main at 5df8adb9fa2f64879a9b80b397af8a096f38ca81  
**Overall status:** Live pilot infrastructure is reachable, but the frontend and API are on different releases. The production authentication client uses a Clerk development key, and the latest API deployment is blocked by a duplicate database migration. Treat the app as a live pilot, not as a verified production-ready release.

## Executive status

| Area | Status on 2026-11-03 | Evidence and impact |
| --- | --- | --- |
| Canonical source | Main is at 5df8adb9 and matches origin/main. At the final status sample, the worktree contains 19 modified tracked files (+2,609/-685) and 8 untracked source/migration files, in addition to this audit report. | None of this local work is part of the deployed commit until it is committed and pushed. |
| Web app | Reachable at https://teacherplat.pages.dev. The served JavaScript bundle identifies commit 5df8adb9. Public GETs to /, /login, /today, and /management returned HTTP 200. | HTTP 200 confirms the SPA shell is served; it does not confirm that authenticated screens or their user flows work. |
| API | Reachable at https://teacheros-api.onrender.com. Liveness and readiness both returned HTTP 200. | Render is still serving commit e07747065a3e0d533351f5259eb144e9214fabc1. Deploy attempts for 762cb570 and 5df8adb9 failed during database startup. |
| Database | Render PostgreSQL is available. | Direct SQL inspection was blocked by the database’s empty external IP allowlist. Migration state is inferred from Render startup logs, not independently queried. |
| Authentication | Clerk is integrated, but the production web bundle uses a pk_test_ key and the API verification key matches that development instance. | This is a development Clerk instance, not a production Clerk instance. Clerk documents pk_test_ for development and pk_live_ for production. [Clerk production deployment guide](https://clerk.com/docs/guides/development/deployment/production) |
| AI | API reports Redis, AI queue, embedded worker, and OpenAI configured. | These health flags check configuration/presence; no authenticated AI request was sent during this audit. |
| File storage | API reports S3/R2 unavailable. | Signed uploads and feedback screenshot storage are not ready in the live environment. |
| CI | GitHub Actions quality workflow passed for deployed commit 5df8adb9. | It ran install, typecheck, lint, test, and build. It does not validate the dirty local tree. |
| Release readiness | Not ready for a general production release. | The migration failure prevents the API from advancing, and the live authentication environment is still test/development. |

## Priority findings

### P1 — API releases are blocked by a duplicate migration

Render’s latest live API deployment is commit e07747065a3e0d533351f5259eb144e9214fabc1, while the frontend serves commit 5df8adb9. The deploy attempt for 5df8adb9 built successfully but failed on startup when the migration runner tried to apply 0026_feedback 2.sql. PostgreSQL returned relation platform_support_users already exists (42P07). The earlier 762cb570 deployment also failed.

The root cause is present in the repository: packages/db/migrations/0026_feedback 2.sql is byte-identical to packages/db/migrations/0026_feedback.sql, but packages/db/scripts/migrate.mjs discovers every .sql file and tracks each by filename. The canonical migration is already applied; the copy is treated as a new migration and repeats unguarded table creation. The integration fixtures enumerate the canonical migration filename explicitly, so they do not reproduce production’s discovery behavior.

**Impact:** the existing API process remains healthy, but code and database changes after e077470 are not active. The current local migrations 0027, 0028, and 0029 are also untracked and are not deployed.

**Evidence:** Render deployment logs for 5df8adb9; packages/db/scripts/migrate.mjs; the duplicate and canonical migration files; migration lists in apps/api/src/v1.integration.test.ts and apps/api/src/admin.integration.test.ts.

### P1 — Production web authentication uses a Clerk development instance

The current live web bundle contains a pk_test_ publishable key. apps/web/src/lib/auth.tsx falls back to a hard-coded development key when the production build has no valid VITE_CLERK_PUBLISHABLE_KEY; the production .env file supplies the API URL but not that key. The Render blueprint contains a corresponding Clerk verification key and still allows legacy and local origins in CLERK_AUTHORIZED_PARTIES.

Clerk identifies pk_test_/sk_test_ as development keys and pk_live_/sk_live_ as production keys. Configure a production Clerk instance, its matching frontend and server credentials, and the intended authorized parties before treating user sign-in as production ready.

**Impact:** sign-in may work against the development instance, but production-domain behavior, provider configuration, and account lifecycle are not established. The production login flow was not completed in a browser during this audit.

### P2 — Demo pilot credentials are shipped in the public login bundle

The login page includes preset pilot-account credentials and a “Fill pilot account” action. The Clerk-mode signInPilot implementation throws that pilot authentication is unavailable. The API’s development-auth setting defaults off and production startup rejects it if enabled, so no server-side authentication bypass was verified. Still, publishing a shared credential is unsafe if it maps to any usable account, and the pilot button is inconsistent with the production Clerk flow.

**Action:** remove the preset credential flow from production builds or replace it with a supported Clerk test/pilot path. Do not publish the credential values in this report.

### P2 — R2/S3 storage is unavailable in production

The live /health/capabilities response reports s3: false. The API’s signed-upload route requires S3-compatible storage credentials, and feedback screenshots use the configured private S3 bucket.

**Impact:** material signed uploads and feedback screenshot attachments are unavailable. Text-only feedback and schedule parsing from request text/base64 input are separate paths; this audit did not establish that schedule parsing is blocked by R2.

### P2 — AI is configured, but the public health signal is weaker than a working AI test

The live capability response is:

database: true, redis: true, aiQueue: true, aiWorker: true, openai: true, s3: false.

In apps/api/src/routes/health.ts, openai means an API key is present, and the queue/worker values mean runtime objects were initialized. They do not prove an OpenAI request can complete. The Render blueprint configures schedule parsing with gpt-5.6-sol and xhigh, while the older project reference says the schedule reader uses gpt-4o. OpenAI currently lists gpt-5.6-sol in its [API pricing and model list](https://platform.openai.com/pricing), but no authenticated request tested its access, file inputs, structured output, latency, or cost in this environment. Segment generation and continuity are configured for gpt-4o.

**Action:** run a post-deploy authenticated smoke flow that queues a representative schedule, observes job completion, and confirms the saved result. Keep the health response described as configuration status unless it is expanded to perform a safe dependency check.

### P2 — Production release checks do not exercise core signed-in flows by default

ops/scripts/production_smoke.sh checks the SPA shell, liveness, readiness, and capability response by default. Without PILOT_TOKEN, it exits before checking authenticated dashboard, schedule, courses, or profile endpoints. AI queue execution and signed upload checks are opt-in. ops/scripts/release_production.sh invokes the smoke script without enabling those checks.

The release script also calls itself the only production release path, but Render is configured with autoDeployTrigger: commit, and the Pages and Render integrations deploy from main independently. This means a direct push can start platform deployments without running the script’s quality gates or exact-commit checks.

**Action:** make the gate and deployment ownership match: either enforce the script/checks as the release path or update the documented process. Add a protected CI/deploy condition and an authenticated post-deploy smoke run for the supported production flows.

### P2 — Redis queue durability and service resilience are limited

Render reports the teacheros-redis Key Value service available on the free plan with persistence disabled and noeviction. The API runs an embedded AI worker and is configured as a single starter instance. Loss or restart of the non-persistent queue service can interrupt or lose queued AI work; a single API instance also limits availability during deploys or instance failure.

The Render PostgreSQL instance is available on the basic 256 MB plan with a 1 GB disk, no high availability, and no replicas. Backup and restore scripts/runbooks exist in the repository, but the actual backup schedule and a successful restore drill were not verified in this audit.

### P2 — Two legacy Render web sites remain active

Render still lists teacheros-web and teacheros-aidan-web as active static sites from the legacy teacher-platform repository, alongside the canonical Cloudflare Pages site. These are not the canonical production frontend described by the current project reference.

**Impact:** users, operators, or search results may reach an old or divergent app. Confirm whether they are still needed; retire or clearly redirect them if they are not.

### P2 — Local feature work is substantial, uncommitted, and unverified

At the final status sample, the checkout has 19 modified tracked files (+2,609/-685 lines) and these 8 untracked source/migration files:

- apps/web/src/lib/editHistory.ts
- apps/web/src/lib/editHistory.test.ts
- apps/web/src/lib/loginReturnPath.ts
- apps/web/src/lib/loginReturnPath.test.ts
- packages/contracts/src/curriculum-pacing.ts
- packages/db/migrations/0027_curriculum_invitations.sql
- packages/db/migrations/0028_shared_lesson_import.sql
- packages/db/migrations/0029_lesson_edit_revision.sql

The modified source appears to add safer login return paths, curriculum pacing/timeline behavior, classroom and Today page changes, lesson editor undo/redo, invitation lifecycle updates, public shared-lesson import, private-note handling, and optimistic revision checks for lesson edits. The database and contract changes include invitation/import support and lesson revision tracking. The exact local diff has not been validated by this audit, and none of it is present in the live deployment.

The current commit’s GitHub workflow passed; that is not evidence that the current worktree passes typecheck, lint, tests, migrations, or build. The untracked 0029_lesson_edit_revision.sql adds lesson edit revision tracking and database triggers; related optimistic revision handling and edit-history utilities appear in the current API/page source. No local tests or builds were run for this audit.

### P2 — Project status documents describe an older release

docs/PROJECT_REFERENCE.md says it is a September 3, 2026 snapshot. It describes the API as Free and cites older deployed commit f5cbd8c; current Render metadata says Starter, the Pages bundle is at 5df8adb9, and the API is at e0774706. The document also describes R2 as not yet confirmed, which remains consistent with the current s3: false signal. V2_IMPLEMENTATION_STATUS.md lists verification as passing without tying that status to a specific commit and contains remaining-work items that no longer match the current feature set.

**Action:** refresh both documents after the release state is repaired. Mark each verification with its commit, date, environment, and evidence.

### P3 — Migration/source duplication and large route modules raise maintenance risk

The repository contains numerous files suffixed with “ 2”, including a second feedback migration and duplicate feedback route/service/test files. The migration duplicate has already caused a failed deployment. apps/api/src/routes/v1.ts contains more than 8,000 lines of route orchestration, with separate large admin and page modules. This increases the chance that copied code or fixtures drift from the files actually deployed.

The CI workflow has no browser end-to-end job or coverage threshold. The current quality run is useful for typecheck, lint, unit/integration tests, and build, but it does not demonstrate a real signed-in user journey through production.

## Application and feature inventory

This table reflects implementation found in the repository. “Present in source” is not a claim that the feature was exercised against production data. The API deployment lag means newer local changes should be considered unreleased.

| Feature area | What the app contains | Current status |
| --- | --- | --- |
| Public entry and shared pages | Landing page, login page, public shared lesson and shared curriculum token routes. | Web shell is live. Public share-token behavior was not exercised. |
| Authentication and onboarding | Clerk integration, development-only auth paths, onboarding/profile creation, setup guide, school/admin access claims. | Production bundle points to Clerk development. The complete sign-in/onboarding journey is unverified. |
| Teacher home / Today | Daily teaching dashboard, today’s classes and lesson plans, upcoming/planned lesson selection, notifications, progress/resume paths. | Code exists; /today serves the SPA shell. Signed-in data behavior was not tested. |
| Courses and sections | Course create/edit/archive/restore/duplicate/order, class sections, meeting days, room and start/end times, course ownership and membership. | Implemented in source; API currently runs an older commit. |
| Schedule and school calendar | Schedule import/review/correction/application, school year, timezone, calendar dates, holidays, instructional days, meeting overrides and history. | Source includes these workflows. Upload-by-signed-file depends on unavailable storage; text/base64 parsing is separate. No production import was run. |
| AI-assisted setup and planning | Queued schedule/calendar parsing, lesson segment generation, continuity support, job status/cancel/retry, and synchronous fallback paths. | Redis, worker, and OpenAI configuration report true. End-to-end production AI behavior is unverified. |
| Curriculum and year planning | Year plan, curriculum/unit/lesson organization, pacing/timeline editing, lesson ordering/stacking, periods/weeks/days, Google Slides links and progress. | Core code exists. Local curriculum pacing changes are uncommitted. |
| Lesson workspace and tracking | Lesson plans and segments, lesson links, section-specific lesson tracker, completion/progress updates and schedule-aware lesson planning. | Code exists; private-note import/collaboration changes in the worktree are unreleased. |
| Classroom workflow | Class meetings, classroom page, lesson progress, class notes and continuity/context for a class. | Code exists. No authenticated classroom scenario was run. |
| Collaboration and sharing | Course invitations and collaborators, school invitations/membership, public share links, activity/comments, pacing/progress sharing, leaving a course, lesson/curriculum import. | Existing sharing support is present. Local changes add invite resend/cancel/lifecycle and shared-lesson import behavior; not deployed. |
| School administration | Admin overview, teacher list/detail, courses, schedules, curriculum, calendar, school settings, access claims and school invitation controls. | Routes and API implementation exist. No admin session or cross-school authorization scenario was exercised. |
| Feedback and support | In-app report submission, support access/inbox, issue grouping/status/replies, notification retries, attachment lifecycle and retention cleanup. | Text support features are in source. Screenshot attachment storage requires unavailable S3/R2; email delivery configuration was not confirmed. |
| File storage | S3-compatible signed uploads for materials and private support screenshots. | Not operational according to live capability response. |
| Account settings | Profile, preferences, sign-out and account-related navigation. | Source and routes exist; authenticated behavior not exercised. |
| Operations | Health endpoints, rate limiting/security headers, request IDs, Sentry hooks, AI queue, backup/restore scripts, release/smoke scripts and runbooks. | Health and public routes respond. Sentry delivery, backups, restore, and full release gates were not verified. |

### Route map found in the web app

- Public: /, /login, /shared/lessons/:token, /shared/curriculum/:token.
- Authenticated teacher: /onboarding, /welcome, /guide, /today, /year-plan, /courses, /courses/:id, /sharing, /school, /classroom, /lessons/:lessonId, /sections/:sectionId/lessons/:lessonId, /profile.
- Redirect aliases: /dashboard to /today, /curriculum to /courses, /schedule to the schedule import view in courses.
- Feedback/support: /management/feedback and /management/feedback/:id.
- Admin: /admin, /admin/teachers, /admin/teachers/:teacherId, /admin/courses, /admin/courses/:courseId, /admin/schedule, /admin/curriculum, /admin/calendar, /admin/school, and /admin/request-access.

The public GET checks only confirmed SPA delivery for a small subset of these paths. They did not authenticate, inspect browser rendering, or exercise route actions.

### Product areas not found in the current implementation

The repository inventory did not show a student/family portal, gradebook, attendance management, billing/subscriptions, an LMS/roster sync, or an offline-first client. This is a codebase observation, not a conclusion that these are requirements. The product requirements or roadmap were not supplied as part of this audit, so feature completeness against intended scope cannot be established from code alone.

## Architecture and operational posture

- **Web:** React + Vite single-page app in apps/web, hosted on Cloudflare Pages at teacherplat.pages.dev.
- **API:** Fastify/TypeScript in apps/api, hosted on Render as teacheros-api.
- **Data:** Drizzle/PostgreSQL in packages/db; SQL migrations are run during Render startup.
- **Jobs:** BullMQ/Redis using Render Key Value, with an embedded worker enabled in the API service and an optional standalone worker app.
- **Contracts:** shared Zod contracts in packages/contracts.
- **AI:** shared worker package calls the OpenAI Responses API with structured output. Current blueprint model settings are schedule parsing gpt-5.6-sol/xhigh, lesson segments gpt-4o, and continuity gpt-4o.
- **Storage:** S3-compatible/R2 code exists, but production capability is false.
- **Environments:** the Render blueprint includes a legacy Pages origin and localhost entries in Clerk authorized parties. Narrow these to the intended production and staging origins when moving to a production Clerk instance.

Positive controls found in source include Clerk JWT verification, production rejection of DEV_AUTH_ENABLED, CORS allowlisting, Helmet, a global rate limit, request IDs, centralized error handling, school-role checks, and explicit redaction of private teacher notes from public/shared responses. This was a source review only; no penetration test or dynamic authorization review was performed.

## Validation performed and limits

### Performed

- Read-only review of source, route map, migrations, CI and release scripts, project status documents, and the local Git state.
- Read-only inspection of Render service/deployment metadata and failed deployment logs.
- HTTP GET checks for the canonical web root and three SPA paths; HTTP health checks for API liveness, readiness, and capabilities.
- Confirmed the currently served web bundle identifies commit 5df8adb9.
- Reviewed the latest GitHub Actions quality workflow result for that commit: install, typecheck, lint, tests, and build succeeded.
- Compared duplicate migration contents and confirmed they are identical.
- Checked official Clerk production guidance for test/live key prefixes.

### Not performed

- No local typecheck, lint, test, build, or database migration was run.
- No sign-in, account creation, admin, teacher, AI job, file upload, feedback, or shared-link workflow was completed in a browser.
- No production database query was run; the database external IP allowlist is empty.
- No backup configuration or restore drill was inspected.
- No SAST, dependency vulnerability scan, penetration test, accessibility audit, load test, or mobile-device review was performed.

## Recommended order of work

1. Repair migration discovery so the duplicate feedback migration cannot run, and make the migration tests exercise the same discovery path used by Render.
2. Review and decide which current local changes are intended for release. Commit the required code and migrations only after the migration issue is corrected; run the repository’s quality gates against that exact commit.
3. Configure Clerk production keys and server verification for the production instance, align authorized parties and domains, and remove the production fallback to a test key and the public pilot credential UI.
4. Deploy the API from the intended commit and verify that migrations 0027 and 0028 complete. Confirm the API and web are serving a consistent release before enabling new UI paths.
5. Run an authenticated smoke flow for sign-in, Today/dashboard, schedule, courses, one AI parse job, and profile. Exercise uploads and feedback screenshots only after storage is configured.
6. Decide whether R2-backed uploads/screenshots are required for launch. Configure and verify the bucket or clearly disable those entry points.
7. Decide the required queue durability, API availability, database capacity, and backup/restore targets before expanding beyond a small pilot.
8. Reconcile the two legacy Render sites, then refresh the project reference and implementation status with current deployment SHAs and dated evidence.

**No application code, deployment settings, or external data were changed during this audit. The only project file created is this report.**
