import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppConfig } from './config.js';

type DbModule = typeof import('@teacheros/db');
type CreateApp = (typeof import('./app.js'))['createApp'];

const runIntegration =
  process.env.RUN_INTEGRATION_DB_TESTS === '1' && Boolean(process.env.DATABASE_URL);
const describeIf = runIntegration ? describe : describe.skip;
const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/db/migrations'
);

const privateTeacherProfileValue = 'private-teacher-profile-value';
const privateClassroomValue = 'private-classroom-value';
const privateDraftValue = 'private-draft-value';

const migrationFiles = [
  '0000_initial.sql',
  '0001_ai_jobs_cancel_status.sql',
  '0002_test_accounts.sql',
  '0003_section_meeting_end_times.sql',
  '0004_unit_timeline_pacing.sql',
  '0005_school_calendar_and_planning.sql',
  '0006_instructional_calendar_types.sql',
  '0007_lesson_plan_workspace.sql',
  '0008_lesson_workspace_sharing.sql',
  '0009_class_meetings.sql',
  '0010_school_timezone.sql',
  '0011_planning_and_meeting_history.sql',
  '0012_course_lifecycle_and_sharing.sql',
  '0013_collaborative_courses.sql',
  '0014_collaboration_activity_comments_pacing.sql',
  '0015_teacher_courses.sql',
  '0016_section_original_schedule_label.sql',
  '0017_unit_google_slides.sql',
  '0018_lesson_google_slides.sql',
  '0019_school_sharing_notifications.sql',
  '0020_role_cleanup.sql',
  '0021_admin_foundation.sql',
  '0022_admin_claim_safety.sql',
  '0023_school_invitations.sql',
  '0024_one_course_owner.sql',
  '0025_school_invitation_expiry.sql'
];

const truncateSql = `
  TRUNCATE TABLE
    ai_outputs,
    ai_jobs,
    class_meetings,
    class_notes,
    section_lesson_slide_state,
    section_unit_slide_state,
    section_plan_operations,
    section_lesson_plans,
    lesson_shares,
    lesson_comments,
    section_lesson_state,
    lesson_segments,
    lessons,
    units,
    section_meetings,
    notifications,
    sections,
    course_activity,
    teacher_courses,
    school_claim_requests,
    school_invitations,
    school_memberships,
    course_collaborators,
    courses,
    teacher_profiles,
    schools,
    users,
    audit_events
  RESTART IDENTITY CASCADE
`;

let app: Awaited<ReturnType<CreateApp>> | undefined;
let dbModule: DbModule | undefined;
let integrationReady = false;
let integrationUnavailableReason = 'Database integration prerequisites are unavailable.';

const adminHeaders = {
  'x-dev-user-id': 'admin-a',
  'x-dev-user-email': 'admin-a@example.com'
};

const teacherHeaders = {
  'x-dev-user-id': 'teacher-a',
  'x-dev-user-email': 'teacher-a@example.com'
};

const teacherBHeaders = {
  'x-dev-user-id': 'teacher-b',
  'x-dev-user-email': 'teacher-b@example.com'
};

type Fixture = {
  schoolAId: string;
  schoolBId: string;
  adminAId: string;
  teacherAId: string;
  teacherBId: string;
  courseAId: string;
  courseBId: string;
  sectionAId: string;
};

let fixture: Fixture | undefined;

function requireDb(): DbModule {
  if (!dbModule) throw new Error(integrationUnavailableReason);
  return dbModule;
}

function testConfig(): AppConfig {
  return {
    NODE_ENV: 'test',
    API_PORT: 3001,
    REQUEST_ID_HEADER: 'x-request-id',
    ENABLE_API_DOCS: false,
    DEV_AUTH_ENABLED: false,
    CLERK_AUTHORIZED_PARTIES: 'http://localhost:5173',
    DATABASE_URL: process.env.DATABASE_URL as string,
    OPENAI_MODEL_CONTINUITY: 'gpt-4o',
    OPENAI_MODEL_GENERATE_SEGMENTS: 'gpt-4o',
    OPENAI_MODEL_PARSE_SCHEDULE: 'gpt-4o-mini',
    OPENAI_REASONING_EFFORT_PARSE_SCHEDULE: 'high',
    RUN_EMBEDDED_AI_WORKER: false,
    REDIS_URL: undefined,
    OPENAI_API_KEY: undefined,
    CLERK_SECRET_KEY: undefined,
    ADMIN_CLAIM_REVIEW_TOKEN: undefined,
    ADMIN_CLAIM_REVIEWER_EMAILS: '',
    S3_REGION: 'auto',
    S3_ENDPOINT: undefined,
    S3_FORCE_PATH_STYLE: false,
    S3_BUCKET: undefined,
    S3_ACCESS_KEY_ID: undefined,
    S3_SECRET_ACCESS_KEY: undefined,
    SENTRY_DSN: undefined
  };
}

async function runMigrations() {
  const { pool } = requireDb();
  const result = await pool.query<{ ready: boolean }>(`
    SELECT
      to_regclass('public.school_invitations') IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'school_invitations'
            AND column_name = 'expires_at'
        ) AS ready
  `);
  if (result.rows[0]?.ready) return;

  for (const fileName of migrationFiles) {
    const sql = await readFile(path.join(migrationsDir, fileName), 'utf8');
    await pool.query(sql);
  }
}

async function resetDatabase() {
  await requireDb().pool.query(truncateSql);
}

async function seedFixture(): Promise<Fixture> {
  const {
    db,
    classMeetings,
    classNotes,
    courses,
    lessons,
    schoolMemberships,
    schoolYears,
    schools,
    sectionMeetings,
    sections,
    teacherProfiles,
    units,
    users
  } = requireDb();
  const schoolAId = randomUUID();
  const schoolBId = randomUUID();
  const adminAId = randomUUID();
  const teacherAId = randomUUID();
  const teacherBId = randomUUID();
  const courseAId = randomUUID();
  const courseBId = randomUUID();
  const unitAId = randomUUID();
  const lessonAId = randomUUID();
  const sectionAId = randomUUID();
  const sectionBId = randomUUID();

  await db.insert(users).values([
    {
      id: adminAId,
      clerkUserId: adminHeaders['x-dev-user-id'],
      email: adminHeaders['x-dev-user-email'],
      fullName: 'Admin A'
    },
    {
      id: teacherAId,
      clerkUserId: teacherHeaders['x-dev-user-id'],
      email: teacherHeaders['x-dev-user-email'],
      fullName: 'Teacher A'
    },
    {
      id: teacherBId,
      clerkUserId: 'teacher-b',
      email: 'teacher-b@example.com',
      fullName: 'Teacher B'
    }
  ]);

  await db.insert(schools).values([
    {
      id: schoolAId,
      name: 'School A',
      district: 'District A',
      state: 'CA',
      timezone: 'America/Los_Angeles',
      inviteCode: 'SCHOOL-A-CODE'
    },
    {
      id: schoolBId,
      name: 'School B',
      district: 'District B',
      state: 'WA',
      timezone: 'America/Los_Angeles',
      inviteCode: 'SCHOOL-B-CODE'
    }
  ]);

  await db.insert(teacherProfiles).values([
    {
      userId: adminAId,
      schoolId: schoolAId,
      role: 'admin',
      onboarded: true,
      phone: 'admin-private-phone',
      workEmail: 'admin-private-work@example.com',
      subjects: ['Administration'],
      grades: []
    },
    {
      userId: teacherAId,
      schoolId: schoolAId,
      role: 'teacher',
      onboarded: true,
      phone: privateTeacherProfileValue,
      workEmail: 'teacher-private-work@example.com',
      subjects: ['Math'],
      grades: ['8']
    },
    {
      userId: teacherBId,
      schoolId: schoolBId,
      role: 'teacher',
      onboarded: true,
      phone: 'teacher-b-private-phone',
      workEmail: 'teacher-b-private-work@example.com',
      subjects: ['Science'],
      grades: ['7']
    }
  ]);

  await db.insert(schoolMemberships).values([
    { userId: adminAId, schoolId: schoolAId, role: 'admin', status: 'active' },
    { userId: teacherAId, schoolId: schoolAId, role: 'teacher', status: 'active' },
    { userId: teacherBId, schoolId: schoolBId, role: 'teacher', status: 'active' }
  ]);
  await db.insert(schoolYears).values({
    schoolId: schoolAId,
    startDate: '2026-08-17',
    endDate: '2027-06-04',
    createdByUserId: adminAId
  });

  await db.insert(courses).values([
    {
      id: courseAId,
      teacherId: teacherAId,
      schoolId: schoolAId,
      name: 'School A Algebra',
      subject: 'Math',
      gradeLevel: '8'
    },
    {
      id: courseBId,
      teacherId: teacherBId,
      schoolId: schoolBId,
      name: 'School B Biology',
      subject: 'Science',
      gradeLevel: '7'
    }
  ]);

  await db.insert(units).values({
    id: unitAId,
    courseId: courseAId,
    title: 'Equations',
    description: privateDraftValue,
    orderIndex: 0
  });
  await db.insert(lessons).values({
    id: lessonAId,
    unitId: unitAId,
    title: 'Solving Equations',
    description: privateDraftValue,
    lessonPlan: {
      objective: 'Solve one-step equations',
      teacherNotes: privateDraftValue,
      studentDirections: null,
      materials: null,
      links: []
    },
    orderIndex: 0
  });

  await db.insert(sections).values([
    { id: sectionAId, courseId: courseAId, teacherId: teacherAId, name: 'Period 1' },
    { id: sectionBId, courseId: courseBId, teacherId: teacherBId, name: 'Period 2' }
  ]);
  await db.insert(sectionMeetings).values([
    {
      sectionId: sectionAId,
      day: 'Monday',
      meetingTime: '08:00',
      endTime: '08:50',
      room: 'A-101'
    },
    {
      sectionId: sectionBId,
      day: 'Monday',
      meetingTime: '09:00',
      endTime: '09:50',
      room: 'B-101'
    }
  ]);
  await db.insert(classNotes).values({
    sectionId: sectionAId,
    userId: teacherAId,
    date: '2026-09-10',
    content: privateClassroomValue
  });
  await db.insert(classMeetings).values({
    sectionId: sectionAId,
    lessonId: lessonAId,
    meetingDate: '2026-09-10',
    rawNote: privateClassroomValue
  });

  return {
    schoolAId,
    schoolBId,
    adminAId,
    teacherAId,
    teacherBId,
    courseAId,
    courseBId,
    sectionAId
  };
}

describeIf('admin integration (requires RUN_INTEGRATION_DB_TESTS=1 and DATABASE_URL)', () => {
  beforeAll(async () => {
    if (!runIntegration) return;

    dbModule = await import('@teacheros/db');
    try {
      await dbModule.pool.query('SELECT 1');
    } catch (error) {
      integrationUnavailableReason =
        error instanceof Error ? error.message : 'Local database is unavailable.';
      return;
    }

    await runMigrations();
    const { createApp } = await import('./app.js');
    app = await createApp(testConfig());
    integrationReady = true;
  });

  beforeEach(async ({ skip }) => {
    if (!integrationReady) skip(integrationUnavailableReason);

    await resetDatabase();
    fixture = await seedFixture();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('denies unauthenticated and teacher callers while allowing an admin caller', async () => {
    const unauthenticated = await app!.inject({
      method: 'GET',
      url: '/v1/admin/teachers'
    });
    expect(unauthenticated.statusCode).toBe(401);

    const teacher = await app!.inject({
      method: 'GET',
      url: '/v1/admin/teachers',
      headers: teacherHeaders
    });
    expect(teacher.statusCode).toBe(403);
    expect(teacher.json()).toMatchObject({ error: 'Administrator access is required.' });

    const admin = await app!.inject({
      method: 'GET',
      url: '/v1/admin/teachers',
      headers: adminHeaders
    });
    expect(admin.statusCode).toBe(200);
    expect(admin.json<{ teachers: Array<{ userId: string }> }>().teachers).toHaveLength(1);
    expect(admin.json<{ teachers: Array<{ userId: string }> }>().teachers[0]?.userId).toBe(
      fixture!.teacherAId
    );
  });

  it('keeps every admin collection and detail route scoped to the admin school', async () => {
    const teachers = await app!.inject({
      method: 'GET',
      url: '/v1/admin/teachers',
      headers: adminHeaders
    });
    expect(teachers.statusCode).toBe(200);
    expect(
      teachers.json<{ teachers: Array<{ userId: string }> }>().teachers.map((row) => row.userId)
    ).toEqual([fixture!.teacherAId]);

    const courses = await app!.inject({
      method: 'GET',
      url: '/v1/admin/courses',
      headers: adminHeaders
    });
    expect(courses.statusCode).toBe(200);
    expect(courses.json<{ courses: Array<{ id: string }> }>().courses.map((row) => row.id)).toEqual(
      [fixture!.courseAId]
    );

    const schedule = await app!.inject({
      method: 'GET',
      url: '/v1/admin/schedule',
      headers: adminHeaders
    });
    expect(schedule.statusCode).toBe(200);
    expect(
      schedule.json<{ entries: Array<{ sectionId: string }> }>().entries.map((row) => row.sectionId)
    ).toEqual([fixture!.sectionAId]);

    const otherTeacher = await app!.inject({
      method: 'GET',
      url: `/v1/admin/teachers/${fixture!.teacherBId}`,
      headers: adminHeaders
    });
    expect(otherTeacher.statusCode).toBe(404);

    const otherCourse = await app!.inject({
      method: 'GET',
      url: `/v1/admin/courses/${fixture!.courseBId}`,
      headers: adminHeaders
    });
    expect(otherCourse.statusCode).toBe(404);

    const otherSchoolClaim = await app!.inject({
      method: 'POST',
      url: '/v1/admin/claims',
      headers: teacherHeaders,
      payload: {
        schoolId: fixture!.schoolBId,
        schoolEmail: 'teacher-a@school-b.edu',
        position: 'Principal'
      }
    });
    expect(otherSchoolClaim.statusCode).toBe(403);
  });

  it('does not include private teacher, classroom, or draft fields in admin responses', async () => {
    const responses = await Promise.all([
      app!.inject({ method: 'GET', url: '/v1/admin', headers: adminHeaders }),
      app!.inject({
        method: 'GET',
        url: `/v1/admin/teachers/${fixture!.teacherAId}`,
        headers: adminHeaders
      }),
      app!.inject({
        method: 'GET',
        url: `/v1/admin/courses/${fixture!.courseAId}`,
        headers: adminHeaders
      }),
      app!.inject({ method: 'GET', url: '/v1/admin/schedule', headers: adminHeaders }),
      app!.inject({ method: 'GET', url: '/v1/admin/school', headers: adminHeaders })
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(JSON.stringify(body)).not.toContain(privateTeacherProfileValue);
      expect(JSON.stringify(body)).not.toContain(privateClassroomValue);
      expect(JSON.stringify(body)).not.toContain(privateDraftValue);
    }

    const teacherDetail = responses[1].json<{ teacher: Record<string, unknown> }>();
    expect(teacherDetail.teacher).not.toHaveProperty('phone');
    expect(teacherDetail.teacher).not.toHaveProperty('workEmail');
    expect(teacherDetail.teacher).not.toHaveProperty('privateNotes');

    const courseDetail = responses[2].json<{
      course: { units: Array<Record<string, unknown>> };
    }>();
    expect(courseDetail.course.units).toEqual([]);
  });

  it('leaves teacher membership and school claim state unchanged for a rejected request', async () => {
    const request = await app!.inject({
      method: 'POST',
      url: '/v1/admin/claims',
      headers: teacherHeaders,
      payload: {
        schoolId: fixture!.schoolAId,
        schoolEmail: 'teacher-a@school-a.edu',
        position: 'Principal',
        verificationNotes: 'Please review this request.'
      }
    });
    expect(request.statusCode).toBe(200);
    const claim = request.json<{ id: string; status: string; createdAt: string }>();
    expect(claim.status).toBe('pending');

    const { db, schoolClaimRequests, schoolMemberships, schools, teacherProfiles } = requireDb();
    const [pendingMembership] = await db
      .select({ role: schoolMemberships.role })
      .from(schoolMemberships)
      .where(
        and(
          eq(schoolMemberships.userId, fixture!.teacherAId),
          eq(schoolMemberships.schoolId, fixture!.schoolAId)
        )
      );
    expect(pendingMembership?.role).toBe('teacher');

    const review = await app!.inject({
      method: 'POST',
      url: `/v1/admin/claims/${claim.id}/review`,
      headers: adminHeaders,
      payload: { status: 'rejected', reviewNotes: 'Not verified.' }
    });
    expect(review.statusCode).toBe(200);

    const [membership] = await db
      .select({ role: schoolMemberships.role, status: schoolMemberships.status })
      .from(schoolMemberships)
      .where(
        and(
          eq(schoolMemberships.userId, fixture!.teacherAId),
          eq(schoolMemberships.schoolId, fixture!.schoolAId)
        )
      );
    const [school] = await db
      .select({ claimStatus: schools.claimStatus })
      .from(schools)
      .where(eq(schools.id, fixture!.schoolAId));
    const [profile] = await db
      .select({ role: teacherProfiles.role })
      .from(teacherProfiles)
      .where(eq(teacherProfiles.userId, fixture!.teacherAId));
    const [storedClaim] = await db
      .select({ status: schoolClaimRequests.status, createdAt: schoolClaimRequests.createdAt })
      .from(schoolClaimRequests)
      .where(eq(schoolClaimRequests.id, claim.id));

    expect(membership).toEqual({ role: 'teacher', status: 'active' });
    expect(school?.claimStatus).toBe('unclaimed');
    expect(profile?.role).toBe('teacher');
    expect(storedClaim?.status).toBe('rejected');
    expect(storedClaim?.createdAt.toISOString()).toBe(claim.createdAt);
  });

  it('preserves createdAt and promotes membership only when a claim is approved', async () => {
    const request = await app!.inject({
      method: 'POST',
      url: '/v1/admin/claims',
      headers: teacherHeaders,
      payload: {
        schoolId: fixture!.schoolAId,
        schoolEmail: 'teacher-a@school-a.edu',
        position: 'Principal'
      }
    });
    expect(request.statusCode).toBe(200);
    const claim = request.json<{ id: string; status: string; createdAt: string }>();
    expect(claim.status).toBe('pending');

    const { db, schoolClaimRequests, schoolMemberships, schools, teacherProfiles } = requireDb();
    const [pendingMembership] = await db
      .select({ role: schoolMemberships.role })
      .from(schoolMemberships)
      .where(
        and(
          eq(schoolMemberships.userId, fixture!.teacherAId),
          eq(schoolMemberships.schoolId, fixture!.schoolAId)
        )
      );
    expect(pendingMembership?.role).toBe('teacher');

    const review = await app!.inject({
      method: 'POST',
      url: `/v1/admin/claims/${claim.id}/review`,
      headers: adminHeaders,
      payload: { status: 'approved' }
    });
    expect(review.statusCode).toBe(200);
    const reviewed = review.json<{ createdAt: string; reviewedAt: string }>();
    expect(reviewed.createdAt).toBe(claim.createdAt);
    expect(reviewed.reviewedAt).not.toBeNull();

    const [storedClaim] = await db
      .select({
        status: schoolClaimRequests.status,
        createdAt: schoolClaimRequests.createdAt,
        reviewedAt: schoolClaimRequests.reviewedAt
      })
      .from(schoolClaimRequests)
      .where(eq(schoolClaimRequests.id, claim.id));
    const [membership] = await db
      .select({ role: schoolMemberships.role, status: schoolMemberships.status })
      .from(schoolMemberships)
      .where(
        and(
          eq(schoolMemberships.userId, fixture!.teacherAId),
          eq(schoolMemberships.schoolId, fixture!.schoolAId)
        )
      );
    const [school] = await db
      .select({
        claimStatus: schools.claimStatus,
        claimedByUserId: schools.claimedByUserId
      })
      .from(schools)
      .where(eq(schools.id, fixture!.schoolAId));
    const [profile] = await db
      .select({ role: teacherProfiles.role })
      .from(teacherProfiles)
      .where(eq(teacherProfiles.userId, fixture!.teacherAId));

    expect(storedClaim?.status).toBe('approved');
    expect(storedClaim?.createdAt.toISOString()).toBe(claim.createdAt);
    expect(storedClaim?.reviewedAt?.toISOString()).toBe(reviewed.reviewedAt);
    expect(membership).toEqual({ role: 'admin', status: 'active' });
    expect(school).toEqual({ claimStatus: 'claimed', claimedByUserId: fixture!.teacherAId });
    expect(profile?.role).toBe('admin');
  });

  it('enforces claimed-school invite and calendar policy at the API boundary', async () => {
    const { db, schools } = requireDb();
    await db
      .update(schools)
      .set({ claimStatus: 'claimed', teacherInvitePolicy: 'admin_only' })
      .where(eq(schools.id, fixture!.schoolAId));

    const codeJoin = await app!.inject({
      method: 'POST',
      url: '/v1/school/join',
      headers: teacherBHeaders,
      payload: { inviteCode: 'SCHOOL-A-CODE' }
    });
    expect(codeJoin.statusCode).toBe(403);

    const teacherCalendarWrite = await app!.inject({
      method: 'POST',
      url: '/v1/school-year',
      headers: teacherHeaders,
      payload: { startDate: '2026-08-17', endDate: '2027-06-04' }
    });
    expect(teacherCalendarWrite.statusCode).toBe(403);

    const adminCalendarWrite = await app!.inject({
      method: 'POST',
      url: '/v1/school-year',
      headers: adminHeaders,
      payload: { startDate: '2026-08-17', endDate: '2027-06-04' }
    });
    expect(adminCalendarWrite.statusCode).toBe(200);

    const teacherLegacyHolidayWrite = await app!.inject({
      method: 'POST',
      url: '/v1/holidays',
      headers: teacherHeaders,
      payload: { holidays: [{ date: '2026-09-14', name: 'Unauthorized closure' }] }
    });
    expect(teacherLegacyHolidayWrite.statusCode).toBe(403);
  });

  it('supports administrator invitations and preserves existing course ownership on school switch', async () => {
    const invitation = await app!.inject({
      method: 'POST',
      url: '/v1/admin/members/invite',
      headers: adminHeaders,
      payload: { email: 'teacher-b@example.com' }
    });
    expect(invitation.statusCode).toBe(200);
    const invitationId = invitation.json<{ invitationId: string }>().invitationId;

    const accepted = await app!.inject({
      method: 'POST',
      url: `/v1/school-invitations/${invitationId}/accept`,
      headers: teacherBHeaders,
      payload: {}
    });
    expect(accepted.statusCode).toBe(200);

    const { db, courses, teacherProfiles, schoolMemberships } = requireDb();
    const [profile] = await db
      .select({ schoolId: teacherProfiles.schoolId })
      .from(teacherProfiles)
      .where(eq(teacherProfiles.userId, fixture!.teacherBId));
    const [membership] = await db
      .select({ status: schoolMemberships.status })
      .from(schoolMemberships)
      .where(
        and(
          eq(schoolMemberships.userId, fixture!.teacherBId),
          eq(schoolMemberships.schoolId, fixture!.schoolAId)
        )
      );
    const [course] = await db
      .select({ schoolId: courses.schoolId })
      .from(courses)
      .where(eq(courses.id, fixture!.courseBId));
    expect(profile?.schoolId).toBe(fixture!.schoolAId);
    expect(membership?.status).toBe('active');
    expect(course?.schoolId).toBe(fixture!.schoolBId);
  });
});
