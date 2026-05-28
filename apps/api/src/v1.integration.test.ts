import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiJobs, auditEvents, db, pool, users } from '@teacheros/db';

import { createApp } from './app.js';
import type { AppConfig } from './config.js';

let app: Awaited<ReturnType<typeof createApp>>;
const runIntegration = process.env.RUN_INTEGRATION_DB_TESTS === '1';
const describeIf = runIntegration ? describe : describe.skip;

const teacherHeaders = {
  'x-dev-user-id': 'teacher-dev-1',
  'x-dev-user-email': 'teacher1@example.com'
};

const otherTeacherHeaders = {
  'x-dev-user-id': 'teacher-dev-2',
  'x-dev-user-email': 'teacher2@example.com'
};

const onboardingBody = {
  fullName: 'Teacher One',
  phone: null,
  workEmail: 'teacher1@example.com',
  schoolName: 'Integration Test School',
  district: 'Test District',
  state: 'CA',
  role: 'teacher' as const,
  subjects: ['Math'],
  grades: ['8']
};

async function runMigrations() {
  const migrationsDir = path.resolve(process.cwd(), '../../packages/db/migrations');
  const migrationFiles = ['0000_initial.sql', '0001_ai_jobs_cancel_status.sql'];

  for (const fileName of migrationFiles) {
    const sql = await readFile(path.join(migrationsDir, fileName), 'utf8');
    await pool.query(sql);
  }
}

async function resetDatabase() {
  await pool.query(`
    TRUNCATE TABLE
      ai_outputs,
      ai_jobs,
      class_notes,
      section_lesson_state,
      lesson_segments,
      lessons,
      units,
      section_meetings,
      sections,
      courses,
      teacher_profiles,
      schools,
      users,
      audit_events
    RESTART IDENTITY CASCADE
  `);
}

describeIf('v1 integration (requires RUN_INTEGRATION_DB_TESTS=1 and local Postgres)', () => {
  beforeAll(async () => {
    await runMigrations();

    const config: AppConfig = {
      NODE_ENV: 'test',
      API_PORT: 3001,
      REQUEST_ID_HEADER: 'x-request-id',
      ENABLE_API_DOCS: false,
      CLERK_AUTHORIZED_PARTIES: 'http://localhost:5173',
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/teacheros_test',
      OPENAI_MODEL_CONTINUITY: 'gpt-4o',
      OPENAI_MODEL_GENERATE_SEGMENTS: 'gpt-4o',
      OPENAI_MODEL_PARSE_SCHEDULE: 'gpt-4o-mini',
      REDIS_URL: undefined,
      OPENAI_API_KEY: undefined,
      CLERK_SECRET_KEY: undefined,
      S3_REGION: 'us-east-1',
      S3_BUCKET: undefined,
      S3_ACCESS_KEY_ID: undefined,
      S3_SECRET_ACCESS_KEY: undefined,
      SENTRY_DSN: undefined
    };

    app = await createApp(config);
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('v1 curriculum CRUD', () => {
    it('supports full nested curriculum CRUD for an onboarded teacher', async () => {
    const onboarding = await app.inject({
      method: 'POST',
      url: '/v1/onboarding',
      headers: teacherHeaders,
      payload: onboardingBody
    });
    expect(onboarding.statusCode).toBe(200);

    const createCourse = await app.inject({
      method: 'POST',
      url: '/v1/courses',
      headers: teacherHeaders,
      payload: {
        name: 'Algebra I',
        subject: 'Math',
        gradeLevel: '8'
      }
    });
    expect(createCourse.statusCode).toBe(200);
      const createdCourse = createCourse.json<{
        course: { id: string; name: string; units: Array<{ id: string }> };
      }>();
    expect(createdCourse.course.name).toBe('Algebra I');
    expect(createdCourse.course.units).toEqual([]);

    const createUnit = await app.inject({
      method: 'POST',
      url: `/v1/courses/${createdCourse.course.id}/units`,
      headers: teacherHeaders,
      payload: {
        title: 'Linear Equations',
        description: 'Solving one-step and two-step equations',
        orderIndex: 0
      }
    });
    expect(createUnit.statusCode).toBe(200);
      const withUnit = createUnit.json<{
        course: { units: Array<{ id: string; title: string; lessons: Array<{ id: string }> }> };
      }>();
    expect(withUnit.course.units).toHaveLength(1);
    expect(withUnit.course.units[0]?.title).toBe('Linear Equations');
    const unitId = withUnit.course.units[0]?.id ?? '';
    expect(unitId).not.toBe('');

    const createLesson = await app.inject({
      method: 'POST',
      url: `/v1/units/${unitId}/lessons`,
      headers: teacherHeaders,
      payload: {
        title: 'Solving for X',
        description: 'Balance method',
        estimatedDurationMinutes: 45
      }
    });
    expect(createLesson.statusCode).toBe(200);
      const withLesson = createLesson.json<{
        course: {
          units: Array<{
            id: string;
            lessons: Array<{ id: string; title: string; segments: Array<{ id: string }> }>;
          }>;
        };
      }>();
    const lesson = withLesson.course.units.find((item) => item.id === unitId)?.lessons[0];
    expect(lesson?.title).toBe('Solving for X');
    const lessonId = lesson?.id ?? '';
    expect(lessonId).not.toBe('');

    const createSegment = await app.inject({
      method: 'POST',
      url: `/v1/lessons/${lessonId}/segments`,
      headers: teacherHeaders,
      payload: {
        title: 'Do Now',
        description: 'Warm-up questions',
        durationMinutes: 7
      }
    });
    expect(createSegment.statusCode).toBe(200);
      const withSegment = createSegment.json<{
        course: {
          units: Array<{
            lessons: Array<{ id: string; segments: Array<{ id: string; title: string }> }>;
          }>;
        };
      }>();
    const segment = withSegment.course.units
      .flatMap((unit) => unit.lessons)
      .find((item) => item.id === lessonId)?.segments[0];
    expect(segment?.title).toBe('Do Now');
    const segmentId = segment?.id ?? '';
    expect(segmentId).not.toBe('');

    const updateSegment = await app.inject({
      method: 'PATCH',
      url: `/v1/segments/${segmentId}`,
      headers: teacherHeaders,
      payload: {
        title: 'Do Now + Attendance'
      }
    });
    expect(updateSegment.statusCode).toBe(200);

    const fetchCourse = await app.inject({
      method: 'GET',
      url: `/v1/courses/${createdCourse.course.id}`,
      headers: teacherHeaders
    });
    expect(fetchCourse.statusCode).toBe(200);
      const fetched = fetchCourse.json<{
        course: {
          units: Array<{
            lessons: Array<{ segments: Array<{ title: string }> }>;
          }>;
        };
      }>();
    expect(fetched.course.units[0]?.lessons[0]?.segments[0]?.title).toBe('Do Now + Attendance');

    const forbiddenFetch = await app.inject({
      method: 'GET',
      url: `/v1/courses/${createdCourse.course.id}`,
      headers: otherTeacherHeaders
    });
    expect(forbiddenFetch.statusCode).toBe(404);

    const deleteSegment = await app.inject({
      method: 'DELETE',
      url: `/v1/segments/${segmentId}`,
      headers: teacherHeaders
    });
    expect(deleteSegment.statusCode).toBe(200);
    expect(deleteSegment.json()).toEqual({ deleted: true });
    });
  });

  describe('v1 AI job controls', () => {
    it('supports cancel, retry, and status fields for AI jobs', async () => {
    const onboarding = await app.inject({
      method: 'POST',
      url: '/v1/onboarding',
      headers: teacherHeaders,
      payload: onboardingBody
    });
    expect(onboarding.statusCode).toBe(200);

    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkUserId, teacherHeaders['x-dev-user-id']))
      .limit(1);
    expect(user).toBeDefined();
    const userId = user?.id ?? '';
    expect(userId).not.toBe('');

    const [queuedJob] = await db
      .insert(aiJobs)
      .values({
        userId,
        type: 'parse_schedule',
        status: 'queued',
        input: { text: 'period 1 algebra' },
        cancelRequested: false
      })
      .returning({ id: aiJobs.id });
    expect(queuedJob).toBeDefined();

    const [runningJob] = await db
      .insert(aiJobs)
      .values({
        userId,
        type: 'generate_segments',
        status: 'running',
        input: { lessonTitle: 'Warm up', durationMinutes: 40 },
        cancelRequested: false
      })
      .returning({ id: aiJobs.id });
    expect(runningJob).toBeDefined();

    const [failedJob] = await db
      .insert(aiJobs)
      .values({
        userId,
        type: 'generate_continuity',
        status: 'failed',
        input: { lessonTitle: 'Recap block' },
        error: 'Timeout'
      })
      .returning({ id: aiJobs.id });
    expect(failedJob).toBeDefined();

    const fakeQueue = {
      add: vi.fn(async () => ({ id: failedJob?.id ?? 'x' })),
      remove: vi.fn(async () => undefined),
      getJob: vi.fn(async (jobId: string) => {
        if (jobId === failedJob?.id) {
          return {
            attemptsMade: 2,
            opts: { attempts: 3 },
            progress: 70
          };
        }
        return null;
      })
    };
    (app as any).aiQueue = fakeQueue;

    const cancelQueued = await app.inject({
      method: 'POST',
      url: `/v1/ai/jobs/${queuedJob?.id}/cancel`,
      headers: teacherHeaders
    });
    expect(cancelQueued.statusCode).toBe(200);
    expect(cancelQueued.json()).toEqual({
      jobId: queuedJob?.id,
      status: 'cancelled',
      action: 'cancelled'
    });

    const cancelRunning = await app.inject({
      method: 'POST',
      url: `/v1/ai/jobs/${runningJob?.id}/cancel`,
      headers: teacherHeaders
    });
    expect(cancelRunning.statusCode).toBe(200);
    expect(cancelRunning.json()).toEqual({
      jobId: runningJob?.id,
      status: 'running',
      action: 'cancelled'
    });

    const [runningAfterCancel] = await db
      .select({
        cancelRequested: aiJobs.cancelRequested
      })
      .from(aiJobs)
      .where(eq(aiJobs.id, runningJob?.id ?? ''))
      .limit(1);
    expect(runningAfterCancel?.cancelRequested).toBe(true);

    const retryFailed = await app.inject({
      method: 'POST',
      url: `/v1/ai/jobs/${failedJob?.id}/retry`,
      headers: teacherHeaders
    });
    expect(retryFailed.statusCode).toBe(200);
    expect(retryFailed.json()).toEqual({
      jobId: failedJob?.id,
      status: 'queued',
      action: 'requeued'
    });
    expect(fakeQueue.add).toHaveBeenCalledTimes(1);

    const status = await app.inject({
      method: 'GET',
      url: `/v1/ai/jobs/${failedJob?.id}`,
      headers: teacherHeaders
    });
    expect(status.statusCode).toBe(200);
      const payload = status.json<{
        status: string;
        canCancel: boolean;
        canRetry: boolean;
        attemptsMade: number;
        maxAttempts: number;
        progressPercent: number;
        cancelRequested: boolean;
        error: string | null;
      }>();

    expect(payload.status).toBe('queued');
    expect(payload.canCancel).toBe(true);
    expect(payload.canRetry).toBe(false);
    expect(payload.attemptsMade).toBe(2);
    expect(payload.maxAttempts).toBe(3);
    expect(payload.progressPercent).toBe(70);
    expect(payload.cancelRequested).toBe(false);
    expect(payload.error).toBeNull();

    const [retriedJob] = await db
      .select({
        status: aiJobs.status,
        cancelRequested: aiJobs.cancelRequested
      })
      .from(aiJobs)
      .where(and(eq(aiJobs.id, failedJob?.id ?? ''), eq(aiJobs.userId, userId)))
      .limit(1);

    expect(retriedJob?.status).toBe('queued');
    expect(retriedJob?.cancelRequested).toBe(false);
    });
  });

  describe('v1 feedback', () => {
    it('persists teacher feedback as an audit event', async () => {
      const onboarding = await app.inject({
        method: 'POST',
        url: '/v1/onboarding',
        headers: teacherHeaders,
        payload: onboardingBody
      });
      expect(onboarding.statusCode).toBe(200);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/feedback',
        headers: teacherHeaders,
        payload: {
          type: 'Confusing',
          page: '/management',
          message: 'The schedule import review needs clearer labels.',
          userAgent: 'vitest'
        }
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json<{ feedbackId: string; saved: true }>();
      expect(payload.saved).toBe(true);
      expect(payload.feedbackId).toMatch(/[0-9a-f-]{36}/);

      const [event] = await db
        .select({
          eventType: auditEvents.eventType,
          entityType: auditEvents.entityType,
          metadata: auditEvents.metadata
        })
        .from(auditEvents)
        .where(eq(auditEvents.id, payload.feedbackId))
        .limit(1);

      expect(event?.eventType).toBe('teacher_feedback_submitted');
      expect(event?.entityType).toBe('feedback');
      expect(event?.metadata).toMatchObject({
        type: 'Confusing',
        page: '/management',
        message: 'The schedule import review needs clearer labels.',
        userAgent: 'vitest',
        email: teacherHeaders['x-dev-user-email']
      });
    });
  });
});
