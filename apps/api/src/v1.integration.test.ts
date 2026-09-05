import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiJobs, auditEvents, db, pool, schoolHolidays, users } from '@teacheros/db';

import { createApp } from './app.js';
import type { AppConfig } from './config.js';

let app: Awaited<ReturnType<typeof createApp>>;
const runIntegration = process.env.RUN_INTEGRATION_DB_TESTS === '1';
const describeIf = runIntegration ? describe : describe.skip;
const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/db/migrations'
);

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
    '0018_lesson_google_slides.sql'
  ];

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
      sections,
      course_activity,
      teacher_courses,
      course_collaborators,
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
      OPENAI_REASONING_EFFORT_PARSE_SCHEDULE: 'high',
      RUN_EMBEDDED_AI_WORKER: false,
      REDIS_URL: undefined,
      OPENAI_API_KEY: undefined,
      CLERK_SECRET_KEY: undefined,
      S3_REGION: 'auto',
      S3_ENDPOINT: undefined,
      S3_FORCE_PATH_STYLE: false,
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

  describe('account email', () => {
    it('keeps a saved work email when an auth request has no email claim', async () => {
      const onboarding = await app.inject({
        method: 'POST',
        url: '/v1/onboarding',
        headers: teacherHeaders,
        payload: { ...onboardingBody, workEmail: 'aidan@school.edu' }
      });
      expect(onboarding.statusCode).toBe(200);

      await db
        .update(users)
        .set({ email: 'teacher-dev-1@placeholder.local' })
        .where(eq(users.clerkUserId, teacherHeaders['x-dev-user-id']));

      const noEmailClaimHeaders = { 'x-dev-user-id': teacherHeaders['x-dev-user-id'] };
      const profile = await app.inject({
        method: 'GET',
        url: '/v1/profile',
        headers: noEmailClaimHeaders
      });

      expect(profile.statusCode).toBe(200);
      expect(profile.json<{ user: { email: string } }>().user.email).toBe('aidan@school.edu');

      const [user] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.clerkUserId, teacherHeaders['x-dev-user-id']))
        .limit(1);
      expect(user?.email).toBe('aidan@school.edu');
    });
  });

  describe('v1 curriculum CRUD', () => {
    it('shares one curriculum while collaborators keep independently named local class groups', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/onboarding',
        headers: teacherHeaders,
        payload: onboardingBody
      });
      await app.inject({
        method: 'POST',
        url: '/v1/onboarding',
        headers: otherTeacherHeaders,
        payload: {
          ...onboardingBody,
          fullName: 'Teacher Two',
          workEmail: 'teacher2@example.com'
        }
      });

      const created = await app.inject({
        method: 'POST',
        url: '/v1/courses',
        headers: teacherHeaders,
        payload: { name: 'Spanish 5', subject: 'World language', gradeLevel: '5' }
      });
      const course = created.json<{ course: { id: string } }>().course;
      const unit = await app.inject({
        method: 'POST',
        url: `/v1/courses/${course.id}/units`,
        headers: teacherHeaders,
        payload: { title: 'Introductions', description: null }
      });
      const unitId = unit.json<{ course: { units: Array<{ id: string }> } }>().course.units[0]!.id;

      const invited = await app.inject({
        method: 'POST',
        url: `/v1/courses/${course.id}/collaborators`,
        headers: teacherHeaders,
        payload: { email: 'teacher2@example.com' }
      });
      expect(invited.statusCode).toBe(200);
      expect(invited.json<{ collaborators: Array<{ status: string }> }>().collaborators).toEqual(
        expect.arrayContaining([expect.objectContaining({ status: 'invited' })])
      );

      const pending = await app.inject({
        method: 'GET',
        url: '/v1/course-invitations',
        headers: otherTeacherHeaders
      });
      expect(
        pending.json<{ invitations: Array<{ course: { id: string } }> }>().invitations
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ course: expect.objectContaining({ id: course.id }) })
        ])
      );
      const accepted = await app.inject({
        method: 'POST',
        url: `/v1/course-invitations/${course.id}/accept`,
        headers: otherTeacherHeaders
      });
      expect(accepted.statusCode).toBe(200);
      expect(
        accepted.json<{ course: { accessRole: string; lifecycle: string } }>().course
      ).toMatchObject({
        accessRole: 'editor',
        lifecycle: 'unlinked'
      });

      const linked = await app.inject({
        method: 'POST',
        url: '/v1/sections',
        headers: otherTeacherHeaders,
        payload: {
          courseId: course.id,
          sectionName: 'Spanish V Honors · Period 4',
          meetings: [{ day: 'Thursday', time: '13:10', endTime: '14:00', room: '204' }]
        }
      });
      expect(linked.statusCode).toBe(200);
      expect(
        linked.json<{ sections: Array<{ sectionName: string; courseId: string }> }>().sections
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sectionName: 'Spanish V Honors · Period 4',
            courseId: course.id
          })
        ])
      );

      const edited = await app.inject({
        method: 'PATCH',
        url: `/v1/units/${unitId}`,
        headers: otherTeacherHeaders,
        payload: { title: 'Shared introductions' }
      });
      expect(edited.statusCode).toBe(200);
      const sourceView = await app.inject({
        method: 'GET',
        url: `/v1/courses/${course.id}`,
        headers: teacherHeaders
      });
      expect(
        sourceView.json<{ course: { units: Array<{ title: string }> } }>().course.units[0]!.title
      ).toBe('Shared introductions');

      const lessonResponse = await app.inject({
        method: 'POST',
        url: `/v1/units/${unitId}/lessons`,
        headers: teacherHeaders,
        payload: { title: 'Greetings', description: 'First shared lesson' }
      });
      const lessonId = lessonResponse.json<{
        course: { units: Array<{ lessons: Array<{ id: string }> }> };
      }>().course.units[0]!.lessons[0]!.id;

      const comment = await app.inject({
        method: 'POST',
        url: `/v1/lessons/${lessonId}/comments`,
        headers: otherTeacherHeaders,
        payload: { body: 'I will add a conversation warm-up for Period 4.' }
      });
      expect(comment.statusCode).toBe(200);
      const comments = await app.inject({
        method: 'GET',
        url: `/v1/lessons/${lessonId}/comments`,
        headers: teacherHeaders
      });
      expect(
        comments.json<{ comments: Array<{ body: string; author: { fullName: string } | null }> }>()
          .comments
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            body: 'I will add a conversation warm-up for Period 4.',
            author: expect.objectContaining({ fullName: 'Teacher Two' })
          })
        ])
      );

      const activity = await app.inject({
        method: 'GET',
        url: `/v1/courses/${course.id}/activity`,
        headers: teacherHeaders
      });
      expect(
        activity.json<{ activity: Array<{ action: string; summary: string }> }>().activity
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: 'unit_updated' }),
          expect.objectContaining({ action: 'lesson_comment_added' })
        ])
      );

      const privatePacing = await app.inject({
        method: 'GET',
        url: `/v1/courses/${course.id}/pacing`,
        headers: teacherHeaders
      });
      expect(
        privatePacing.json<{ participants: Array<{ fullName: string }> }>().participants
      ).toHaveLength(1);

      const sharedPacing = await app.inject({
        method: 'PATCH',
        url: `/v1/courses/${course.id}/pacing-sharing`,
        headers: otherTeacherHeaders,
        payload: { enabled: true }
      });
      expect(sharedPacing.statusCode).toBe(200);
      const comparedPacing = await app.inject({
        method: 'GET',
        url: `/v1/courses/${course.id}/pacing`,
        headers: teacherHeaders
      });
      expect(
        comparedPacing.json<{
          participants: Array<{
            fullName: string;
            classGroups: Array<{ sectionName: string; lessonTitle: string | null }>;
          }>;
        }>().participants
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fullName: 'Teacher Two',
            classGroups: expect.arrayContaining([
              expect.objectContaining({
                sectionName: 'Spanish V Honors · Period 4',
                lessonTitle: 'Greetings'
              })
            ])
          })
        ])
      );
    });

    it('keeps one unit deck with an independent slide position for each class group', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/onboarding',
        headers: teacherHeaders,
        payload: onboardingBody
      });
      const created = await app.inject({
        method: 'POST',
        url: '/v1/courses',
        headers: teacherHeaders,
        payload: { name: 'Biology', subject: 'Science', gradeLevel: '9' }
      });
      const courseId = created.json<{ course: { id: string } }>().course.id;
      const unitResponse = await app.inject({
        method: 'POST',
        url: `/v1/courses/${courseId}/units`,
        headers: teacherHeaders,
        payload: {
          title: 'Cells',
          description: null,
          googleSlidesUrl: 'https://docs.google.com/presentation/d/deck-one/edit',
          googleSlidesStartSlide: 3
        }
      });
      const unitId = unitResponse.json<{ course: { units: Array<{ id: string }> } }>().course
        .units[0]!.id;
      const lessonResponse = await app.inject({
        method: 'POST',
        url: `/v1/units/${unitId}/lessons`,
        headers: teacherHeaders,
        payload: { title: 'Cell structure', description: null, estimatedDurationMinutes: 45 }
      });
      const lessonId = lessonResponse.json<{
        course: { units: Array<{ lessons: Array<{ id: string }> }> };
      }>().course.units[0]!.lessons[0]!.id;
      const sectionIds: string[] = [];
      for (const sectionName of ['Group A', 'Group B']) {
        const sectionResponse = await app.inject({
          method: 'POST',
          url: '/v1/sections',
          headers: teacherHeaders,
          payload: { courseId, sectionName, meetings: [] }
        });
        const section = sectionResponse
          .json<{ sections: Array<{ sectionId: string; sectionName: string }> }>()
          .sections.find((item) => item.sectionName === sectionName);
        sectionIds.push(section!.sectionId);
      }

      const [groupA, groupB] = sectionIds;
      const initial = await app.inject({
        method: 'GET',
        url: `/v1/sections/${groupA}/units/${unitId}/slides`,
        headers: teacherHeaders
      });
      expect(initial.json()).toMatchObject({ currentSlide: 3, updatedAt: null });
      const advanced = await app.inject({
        method: 'PATCH',
        url: `/v1/sections/${groupA}/units/${unitId}/slides`,
        headers: teacherHeaders,
        payload: { currentSlide: 7 }
      });
      expect(advanced.statusCode).toBe(200);
      expect(advanced.json()).toMatchObject({ currentSlide: 7 });
      const otherGroup = await app.inject({
        method: 'GET',
        url: `/v1/sections/${groupB}/units/${unitId}/slides`,
        headers: teacherHeaders
      });
      expect(otherGroup.json()).toMatchObject({ currentSlide: 3, updatedAt: null });

      const workspace = await app.inject({
        method: 'GET',
        url: `/v1/lessons/${lessonId}/workspace`,
        headers: teacherHeaders
      });
      expect(workspace.json()).toMatchObject({
        unit: {
          googleSlidesUrl: 'https://docs.google.com/presentation/d/deck-one/edit',
          googleSlidesStartSlide: 3
        }
      });

      await app.inject({
        method: 'PATCH',
        url: `/v1/lessons/${lessonId}`,
        headers: teacherHeaders,
        payload: {
          googleSlidesUrl: 'https://docs.google.com/presentation/d/lesson-deck/edit',
          googleSlidesStartSlide: 4
        }
      });
      const lessonInitial = await app.inject({
        method: 'GET',
        url: `/v1/sections/${groupA}/lessons/${lessonId}/slides`,
        headers: teacherHeaders
      });
      expect(lessonInitial.json()).toMatchObject({ currentSlide: 4, updatedAt: null });
      const lessonAdvanced = await app.inject({
        method: 'PATCH',
        url: `/v1/sections/${groupA}/lessons/${lessonId}/slides`,
        headers: teacherHeaders,
        payload: { currentSlide: 9 }
      });
      expect(lessonAdvanced.json()).toMatchObject({ currentSlide: 9 });
      const lessonOtherGroup = await app.inject({
        method: 'GET',
        url: `/v1/sections/${groupB}/lessons/${lessonId}/slides`,
        headers: teacherHeaders
      });
      expect(lessonOtherGroup.json()).toMatchObject({ currentSlide: 4, updatedAt: null });

      await app.inject({
        method: 'PATCH',
        url: `/v1/units/${unitId}`,
        headers: teacherHeaders,
        payload: {
          googleSlidesUrl: 'https://docs.google.com/presentation/d/deck-two/edit',
          googleSlidesStartSlide: 2
        }
      });
      const reset = await app.inject({
        method: 'GET',
        url: `/v1/sections/${groupA}/units/${unitId}/slides`,
        headers: teacherHeaders
      });
      expect(reset.json()).toMatchObject({ currentSlide: 2, updatedAt: null });
    });

    it('updates reviewed imports in place without duplicating a class group or its history identity', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/onboarding',
        headers: teacherHeaders,
        payload: onboardingBody
      });
      const firstImport = await app.inject({
        method: 'POST',
        url: '/v1/schedule/import/apply',
        headers: teacherHeaders,
        payload: {
          classes: [
            {
              name: 'Spanish 5',
              period: '5B',
              days: ['Monday', 'Friday'],
              time: '09:00',
              endTime: '09:50',
              room: '12',
              subject: 'World language'
            }
          ]
        }
      });
      expect(firstImport.statusCode).toBe(200);
      const firstSection = firstImport
        .json<{
          sections: Array<{
            sectionId: string;
            sectionName: string;
            meetings: Array<{ day: string }>;
          }>;
        }>()
        .sections.find((section) => section.sectionName === '5B')!;
      expect(firstSection.meetings.map((meeting) => meeting.day)).toEqual(['Monday', 'Friday']);

      const correctedImport = await app.inject({
        method: 'POST',
        url: '/v1/schedule/import/apply',
        headers: teacherHeaders,
        payload: {
          classes: [
            {
              name: 'Spanish 5',
              period: '5B',
              days: ['Wednesday', 'Thursday'],
              time: '13:00',
              endTime: '13:50',
              room: '12',
              subject: 'World language'
            }
          ]
        }
      });
      expect(correctedImport.statusCode).toBe(200);
      const matchingSections = correctedImport
        .json<{
          sections: Array<{
            sectionId: string;
            sectionName: string;
            meetings: Array<{ day: string; time: string | null }>;
          }>;
        }>()
        .sections.filter((section) => section.sectionName === '5B');
      expect(matchingSections).toHaveLength(1);
      expect(matchingSections[0]?.sectionId).toBe(firstSection.sectionId);
      expect(matchingSections[0]?.meetings).toEqual([
        expect.objectContaining({ day: 'Wednesday', time: '13:00' }),
        expect.objectContaining({ day: 'Thursday', time: '13:00' })
      ]);
    });

    it('copies independent curriculum into an existing scheduled empty course without replacing its Class Group', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/onboarding',
        headers: teacherHeaders,
        payload: onboardingBody
      });
      const sourceResponse = await app.inject({
        method: 'POST',
        url: '/v1/courses',
        headers: teacherHeaders,
        payload: { name: 'Spanish 5', subject: 'Spanish', gradeLevel: '5' }
      });
      const sourceCourseId = sourceResponse.json<{ course: { id: string } }>().course.id;
      const sourceWithUnit = await app.inject({
        method: 'POST',
        url: `/v1/courses/${sourceCourseId}/units`,
        headers: teacherHeaders,
        payload: {
          title: 'Introductions',
          description: 'Greeting and introductions',
          orderIndex: 0,
          plannedStartMeeting: 2,
          plannedMeetingCount: 4
        }
      });
      const sourceUnitId = sourceWithUnit.json<{
        course: { units: Array<{ id: string }> };
      }>().course.units[0]!.id;
      const sourceWithLesson = await app.inject({
        method: 'POST',
        url: `/v1/units/${sourceUnitId}/lessons`,
        headers: teacherHeaders,
        payload: {
          title: 'Hello and goodbye',
          description: 'Core greetings',
          estimatedDurationMinutes: 45,
          plannedStartMeeting: 2,
          plannedMeetingCount: 1
        }
      });
      const sourceLessonId = sourceWithLesson.json<{
        course: { units: Array<{ lessons: Array<{ id: string }> }> };
      }>().course.units[0]!.lessons[0]!.id;
      const sourceWithStep = await app.inject({
        method: 'POST',
        url: `/v1/lessons/${sourceLessonId}/segments`,
        headers: teacherHeaders,
        payload: {
          title: 'Warm-up',
          description: 'Practice greetings',
          durationMinutes: 8,
          stepType: 'warm_up'
        }
      });
      const sourceStepId = sourceWithStep.json<{
        course: { units: Array<{ lessons: Array<{ segments: Array<{ id: string }> }> }> };
      }>().course.units[0]!.lessons[0]!.segments[0]!.id;

      const imported = await app.inject({
        method: 'POST',
        url: '/v1/schedule/import/apply',
        headers: teacherHeaders,
        payload: {
          classes: [
            {
              name: 'Spanish 6',
              period: 'Group A',
              days: ['Monday', 'Wednesday'],
              time: '12:50',
              endTime: '13:40',
              room: '12',
              subject: 'Spanish',
              grade: '6'
            }
          ]
        }
      });
      const importedSection = imported
        .json<{
          sections: Array<{
            courseId: string;
            courseName: string;
            sectionId: string;
            meetings: Array<{ day: string; time: string | null }>;
          }>;
        }>()
        .sections.find((section) => section.courseName === 'Spanish 6')!;
      const destinationCourseId = importedSection.courseId;
      const sectionIdBefore = importedSection.sectionId;
      const meetingsBefore = importedSection.meetings;

      const copied = await app.inject({
        method: 'POST',
        url: `/v1/courses/${destinationCourseId}/curriculum/copy`,
        headers: teacherHeaders,
        payload: { sourceCourseId }
      });
      expect(copied.statusCode).toBe(200);
      const destination = copied.json<{
        course: {
          id: string;
          units: Array<{
            id: string;
            title: string;
            plannedStartMeeting: number | null;
            lessons: Array<{
              id: string;
              plannedStartMeeting: number | null;
              segments: Array<{ id: string }>;
            }>;
          }>;
        };
      }>().course;
      expect(destination.id).toBe(destinationCourseId);
      expect(destination.units[0]).toMatchObject({
        title: 'Introductions',
        plannedStartMeeting: 2
      });
      expect(destination.units[0]!.id).not.toBe(sourceUnitId);
      expect(destination.units[0]!.lessons[0]!.id).not.toBe(sourceLessonId);
      expect(destination.units[0]!.lessons[0]!.segments[0]!.id).not.toBe(sourceStepId);

      const scheduleAfterCopy = await app.inject({
        method: 'GET',
        url: '/v1/schedule',
        headers: teacherHeaders
      });
      const destinationSectionAfter = scheduleAfterCopy
        .json<{
          sections: Array<{
            courseId: string;
            sectionId: string;
            meetings: Array<{ day: string; time: string | null }>;
          }>;
        }>()
        .sections.find((section) => section.courseId === destinationCourseId)!;
      expect(destinationSectionAfter.sectionId).toBe(sectionIdBefore);
      expect(destinationSectionAfter.meetings).toEqual(meetingsBefore);

      await app.inject({
        method: 'PATCH',
        url: `/v1/units/${destination.units[0]!.id}`,
        headers: teacherHeaders,
        payload: { title: 'Spanish 6 introductions' }
      });
      const sourceAfterEdit = await app.inject({
        method: 'GET',
        url: `/v1/courses/${sourceCourseId}`,
        headers: teacherHeaders
      });
      expect(
        sourceAfterEdit.json<{ course: { units: Array<{ title: string }> } }>().course.units[0]!
          .title
      ).toBe('Introductions');

      const reimported = await app.inject({
        method: 'POST',
        url: '/v1/schedule/import/apply',
        headers: teacherHeaders,
        payload: {
          classes: [
            {
              name: 'Spanish 6',
              period: 'Group A',
              days: ['Monday', 'Thursday'],
              time: '12:50',
              endTime: '13:40',
              room: '12',
              subject: 'Spanish',
              grade: '6'
            }
          ]
        }
      });
      const reimportedSection = reimported
        .json<{
          sections: Array<{ courseId: string; sectionId: string }>;
        }>()
        .sections.find((section) => section.courseId === destinationCourseId)!;
      expect(reimportedSection.sectionId).toBe(sectionIdBefore);
      const destinationAfterReimport = await app.inject({
        method: 'GET',
        url: `/v1/courses/${destinationCourseId}`,
        headers: teacherHeaders
      });
      expect(
        destinationAfterReimport.json<{ course: { units: Array<{ title: string }> } }>().course
          .units[0]!.title
      ).toBe('Spanish 6 introductions');
    });

    it('creates a confirmed Year Plan range transactionally at effective meeting indices', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/onboarding',
        headers: teacherHeaders,
        payload: onboardingBody
      });
      const courseResponse = await app.inject({
        method: 'POST',
        url: '/v1/courses',
        headers: teacherHeaders,
        payload: { name: 'Spanish 5', subject: 'World language', gradeLevel: '5' }
      });
      const courseId = courseResponse.json<{ course: { id: string } }>().course.id;

      const createUnitRange = await app.inject({
        method: 'PATCH',
        url: `/v1/courses/${courseId}/planning-range`,
        headers: teacherHeaders,
        payload: {
          kind: 'unit',
          title: 'Introducing yourself',
          plannedStartMeeting: 3,
          plannedMeetingCount: 4,
          lessonTitles: ['Model', 'Partner practice']
        }
      });
      expect(createUnitRange.statusCode).toBe(200);
      const created = createUnitRange.json<{
        course: {
          units: Array<{
            id: string;
            plannedStartMeeting: number | null;
            plannedMeetingCount: number | null;
            lessons: Array<{ title: string; plannedStartMeeting: number | null }>;
          }>;
        };
      }>();
      const unit = created.course.units[0]!;
      expect(unit.plannedStartMeeting).toBe(3);
      expect(unit.plannedMeetingCount).toBe(4);
      expect(unit.lessons.map((lesson) => lesson.title)).toEqual(['Model', 'Partner practice']);
      expect(unit.lessons.map((lesson) => lesson.plannedStartMeeting)).toEqual([3, 5]);

      const createLessonRange = await app.inject({
        method: 'PATCH',
        url: `/v1/courses/${courseId}/planning-range`,
        headers: teacherHeaders,
        payload: {
          kind: 'lessons',
          unitId: unit.id,
          plannedStartMeeting: 8,
          plannedMeetingCount: 2,
          lessonTitles: ['Exit ticket']
        }
      });
      expect(createLessonRange.statusCode).toBe(200);
      expect(
        createLessonRange
          .json<{
            course: {
              units: Array<{
                lessons: Array<{ title: string; plannedStartMeeting: number | null }>;
              }>;
            };
          }>()
          .course.units[0]!.lessons.map((lesson) => [lesson.title, lesson.plannedStartMeeting])
      ).toContainEqual(['Exit ticket', 8]);
    });

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

      const createSecondSegment = await app.inject({
        method: 'POST',
        url: `/v1/lessons/${lessonId}/segments`,
        headers: teacherHeaders,
        payload: {
          title: 'Guided practice',
          description: null,
          durationMinutes: 12
        }
      });
      expect(createSecondSegment.statusCode).toBe(200);
      const reordered = await app.inject({
        method: 'PATCH',
        url: `/v1/lessons/${lessonId}/segments/reorder`,
        headers: teacherHeaders,
        payload: {
          segmentIds: createSecondSegment
            .json<{
              course: {
                units: Array<{ lessons: Array<{ id: string; segments: Array<{ id: string }> }> }>;
              };
            }>()
            .course.units.flatMap((unit) => unit.lessons)
            .find((item) => item.id === lessonId)!
            .segments.map((item) => item.id)
            .reverse()
        }
      });
      expect(reordered.statusCode).toBe(200);
      expect(
        reordered
          .json<{
            course: {
              units: Array<{ lessons: Array<{ id: string; segments: Array<{ title: string }> }> }>;
            };
          }>()
          .course.units.flatMap((unit) => unit.lessons)
          .find((item) => item.id === lessonId)!
          .segments.map((item) => item.title)
      ).toEqual(['Guided practice', 'Do Now + Attendance']);

      const enableShare = await app.inject({
        method: 'PATCH',
        url: `/v1/lessons/${lessonId}/share`,
        headers: teacherHeaders,
        payload: { enabled: true }
      });
      expect(enableShare.statusCode).toBe(200);
      const publicLesson = await app.inject({
        method: 'GET',
        url: `/v1/public/lessons/${enableShare.json<{ token: string }>().token}`
      });
      expect(publicLesson.statusCode).toBe(200);
      const sharePayload = publicLesson.json<{
        courseName: string;
        lesson: {
          title: string;
          links: Array<{ title: string; url: string }>;
          steps: Array<{ title: string }>;
        };
      }>();
      expect(sharePayload).toEqual({
        courseName: 'Algebra I',
        unitTitle: 'Linear Equations',
        lesson: expect.objectContaining({
          title: 'Solving for X',
          links: [],
          steps: expect.arrayContaining([expect.objectContaining({ title: 'Guided practice' })])
        })
      });
      expect(sharePayload.lesson).not.toHaveProperty('id');
      expect(sharePayload).not.toHaveProperty('courseId');

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
      expect(fetched.course.units[0]?.lessons[0]?.segments[0]?.title).toBe('Guided practice');

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
        close: vi.fn(async () => undefined),
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

  describe('v1 holidays', () => {
    it('supports adding, listing, ownership checks, and removing no-school days', async () => {
      const onboarding = await app.inject({
        method: 'POST',
        url: '/v1/onboarding',
        headers: teacherHeaders,
        payload: onboardingBody
      });
      expect(onboarding.statusCode).toBe(200);

      const otherOnboarding = await app.inject({
        method: 'POST',
        url: '/v1/onboarding',
        headers: otherTeacherHeaders,
        payload: {
          ...onboardingBody,
          fullName: 'Teacher Two',
          workEmail: 'teacher2@example.com',
          schoolName: 'Other Integration School'
        }
      });
      expect(otherOnboarding.statusCode).toBe(200);

      const upsert = await app.inject({
        method: 'POST',
        url: '/v1/holidays',
        headers: teacherHeaders,
        payload: {
          holidays: [{ date: '2026-11-25', name: 'Fall Break' }]
        }
      });
      expect(upsert.statusCode).toBe(200);
      expect(upsert.json()).toEqual({ count: 1 });

      const schedule = await app.inject({
        method: 'GET',
        url: '/v1/schedule',
        headers: teacherHeaders
      });
      expect(schedule.statusCode).toBe(200);
      const schedulePayload = schedule.json<{
        holidays: Array<{ id: string; date: string; name: string }>;
      }>();
      expect(schedulePayload.holidays).toHaveLength(1);
      expect(schedulePayload.holidays[0]).toMatchObject({
        date: '2026-11-25',
        name: 'Fall Break'
      });
      const holidayId = schedulePayload.holidays[0]?.id ?? '';
      expect(holidayId).not.toBe('');

      const forbiddenDelete = await app.inject({
        method: 'DELETE',
        url: `/v1/holidays/${holidayId}`,
        headers: otherTeacherHeaders
      });
      expect(forbiddenDelete.statusCode).toBe(404);

      const stillExists = await db
        .select({ id: schoolHolidays.id })
        .from(schoolHolidays)
        .where(eq(schoolHolidays.id, holidayId))
        .limit(1);
      expect(stillExists).toHaveLength(1);

      const deleteHoliday = await app.inject({
        method: 'DELETE',
        url: `/v1/holidays/${holidayId}`,
        headers: teacherHeaders
      });
      expect(deleteHoliday.statusCode).toBe(200);
      expect(deleteHoliday.json()).toEqual({ deleted: true });

      const afterDelete = await app.inject({
        method: 'GET',
        url: '/v1/schedule',
        headers: teacherHeaders
      });
      expect(afterDelete.statusCode).toBe(200);
      expect(afterDelete.json<{ holidays: unknown[] }>().holidays).toEqual([]);
    });
  });

  describe('effective meeting instances', () => {
    it('applies legacy holidays and normal/alternate section overrides', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/onboarding',
        headers: teacherHeaders,
        payload: onboardingBody
      });
      const courseResponse = await app.inject({
        method: 'POST',
        url: '/v1/courses',
        headers: teacherHeaders,
        payload: { name: 'Spanish 7', subject: 'World Languages', gradeLevel: '7' }
      });
      const courseId = courseResponse.json<{ course: { id: string } }>().course.id;
      await app.inject({
        method: 'POST',
        url: '/v1/school-year',
        headers: teacherHeaders,
        payload: { startDate: '2026-01-01', endDate: '2026-12-31' }
      });
      const sectionResponse = await app.inject({
        method: 'POST',
        url: '/v1/sections',
        headers: teacherHeaders,
        payload: {
          courseId,
          sectionName: 'Group C',
          meetings: [{ day: 'Monday', time: '10:20', endTime: '11:10', room: '101' }]
        }
      });
      const sectionId = sectionResponse.json<{ sections: Array<{ sectionId: string }> }>()
        .sections[0]!.sectionId;
      const baseline = await app.inject({
        method: 'GET',
        url: '/v1/meeting-instances?startDate=2026-09-07&endDate=2026-09-07',
        headers: teacherHeaders
      });
      expect(baseline.json<{ meetings: Array<{ sectionId: string }> }>().meetings).toEqual([
        expect.objectContaining({ sectionId })
      ]);
      await app.inject({
        method: 'POST',
        url: '/v1/holidays',
        headers: teacherHeaders,
        payload: { holidays: [{ date: '2026-09-07', name: 'Labor Day' }] }
      });
      const closed = await app.inject({
        method: 'GET',
        url: '/v1/meeting-instances?startDate=2026-09-07&endDate=2026-09-07',
        headers: teacherHeaders
      });
      expect(closed.json<{ meetings: unknown[] }>().meetings).toEqual([]);
      await app.inject({
        method: 'POST',
        url: `/v1/sections/${sectionId}/meeting-overrides`,
        headers: teacherHeaders,
        payload: {
          date: '2026-09-14',
          startTime: '09:00',
          endTime: '09:30',
          room: '102',
          cancelled: false
        }
      });
      await app.inject({
        method: 'POST',
        url: `/v1/sections/${sectionId}/meeting-overrides`,
        headers: teacherHeaders,
        payload: {
          date: '2026-09-16',
          startTime: '13:00',
          endTime: '13:30',
          room: '103',
          cancelled: false
        }
      });
      const overridden = await app.inject({
        method: 'GET',
        url: '/v1/meeting-instances?startDate=2026-09-14&endDate=2026-09-16',
        headers: teacherHeaders
      });
      expect(
        overridden.json<{ meetings: Array<{ date: string; startTime: string | null }> }>().meetings
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ date: '2026-09-14', startTime: '09:00' }),
          expect.objectContaining({ date: '2026-09-16', startTime: '13:00' })
        ])
      );
    });
  });

  describe('Phase 2 planning and meeting history', () => {
    type CourseDetailPayload = {
      course: {
        id: string;
        units: Array<{
          id: string;
          lessons: Array<{ id: string; segments: Array<{ id: string; title: string }> }>;
        }>;
      };
    };

    async function fixture() {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/onboarding',
            headers: teacherHeaders,
            payload: onboardingBody
          })
        ).statusCode
      ).toBe(200);
      const course = (
        await app.inject({
          method: 'POST',
          url: '/v1/courses',
          headers: teacherHeaders,
          payload: { name: 'Spanish 5', subject: 'World Languages', gradeLevel: '5' }
        })
      ).json<{ course: { id: string } }>();
      const unit = (
        await app.inject({
          method: 'POST',
          url: `/v1/courses/${course.course.id}/units`,
          headers: teacherHeaders,
          payload: { title: 'Unit 1', description: null, orderIndex: 0 }
        })
      ).json<CourseDetailPayload>();
      const unitId = unit.course.units[0]!.id;
      const firstLesson = (
        await app.inject({
          method: 'POST',
          url: `/v1/units/${unitId}/lessons`,
          headers: teacherHeaders,
          payload: {
            title: 'Introducing Yourself',
            description: null,
            estimatedDurationMinutes: null,
            plannedStartMeeting: 0,
            plannedMeetingCount: 1
          }
        })
      ).json<CourseDetailPayload>();
      const lessonOneId = firstLesson.course.units[0]!.lessons[0]!.id;
      const secondLesson = (
        await app.inject({
          method: 'POST',
          url: `/v1/units/${unitId}/lessons`,
          headers: teacherHeaders,
          payload: {
            title: 'Partner Introductions',
            description: null,
            estimatedDurationMinutes: null,
            plannedStartMeeting: 1,
            plannedMeetingCount: 1
          }
        })
      ).json<CourseDetailPayload>();
      const lessonTwoId = secondLesson.course.units[0]!.lessons.find(
        (lesson) => lesson.id !== lessonOneId
      )!.id;
      let detail = secondLesson;
      for (const [title, orderIndex] of [
        ['Warm-up', 0],
        ['Model', 1],
        ['Partner Practice', 2]
      ] as const) {
        detail = (
          await app.inject({
            method: 'POST',
            url: `/v1/lessons/${lessonOneId}/segments`,
            headers: teacherHeaders,
            payload: { title, description: null, durationMinutes: 5, orderIndex }
          })
        ).json<typeof detail>();
      }
      const lessonOne = detail.course.units[0]!.lessons.find(
        (lesson) => lesson.id === lessonOneId
      )!;
      const [stepOne, stepTwo, stepThree] = lessonOne.segments;
      await app.inject({
        method: 'POST',
        url: `/v1/lessons/${lessonTwoId}/segments`,
        headers: teacherHeaders,
        payload: { title: 'Listen', description: null, durationMinutes: 5, orderIndex: 0 }
      });
      const withAllSecondLessonSteps = (
        await app.inject({
          method: 'POST',
          url: `/v1/lessons/${lessonTwoId}/segments`,
          headers: teacherHeaders,
          payload: { title: 'Respond', description: null, durationMinutes: 5, orderIndex: 1 }
        })
      ).json<CourseDetailPayload>();
      const [lessonTwoStepOne, lessonTwoStepTwo] =
        withAllSecondLessonSteps.course.units[0]!.lessons.find(
          (lesson) => lesson.id === lessonTwoId
        )!.segments;
      const sectionsResponse = await app.inject({
        method: 'POST',
        url: '/v1/sections',
        headers: teacherHeaders,
        payload: {
          courseId: course.course.id,
          sectionName: 'Spanish 5B',
          meetings: [
            { day: 'Monday', time: '10:00', endTime: '10:50', room: null },
            { day: 'Monday', time: '14:00', endTime: '14:50', room: null }
          ]
        }
      });
      const sectionOneId = sectionsResponse
        .json<{ sections: Array<{ sectionId: string; sectionName: string }> }>()
        .sections.find((section) => section.sectionName === 'Spanish 5B')!.sectionId;
      const secondSectionResponse = await app.inject({
        method: 'POST',
        url: '/v1/sections',
        headers: teacherHeaders,
        payload: {
          courseId: course.course.id,
          sectionName: 'Spanish 5C',
          meetings: [{ day: 'Wednesday', time: '10:00', endTime: '10:50', room: null }]
        }
      });
      const sectionTwoId = secondSectionResponse
        .json<{ sections: Array<{ sectionId: string; sectionName: string }> }>()
        .sections.find((section) => section.sectionName === 'Spanish 5C')!.sectionId;
      return {
        courseId: course.course.id,
        lessonOneId,
        lessonTwoId,
        stepOne: stepOne!.id,
        stepTwo: stepTwo!.id,
        stepThree: stepThree!.id,
        lessonTwoStepOne: lessonTwoStepOne!.id,
        lessonTwoStepTwo: lessonTwoStepTwo!.id,
        sectionOneId,
        sectionTwoId
      };
    }

    it('isolates section planning and preserves revision-safe occurrence history', async () => {
      const data = await fixture();
      await app.inject({
        method: 'POST',
        url: '/v1/school-year',
        headers: teacherHeaders,
        payload: { startDate: '2026-01-01', endDate: '2026-12-31' }
      });
      const perBlockOverride = await app.inject({
        method: 'POST',
        url: `/v1/sections/${data.sectionOneId}/meeting-overrides`,
        headers: teacherHeaders,
        payload: {
          date: '2026-09-07',
          scheduledStartTime: '14:00',
          startTime: '15:00',
          endTime: '15:50',
          room: null,
          cancelled: false
        }
      });
      expect(perBlockOverride.statusCode).toBe(200);
      const sameDayMeetings = await app.inject({
        method: 'GET',
        url: '/v1/meeting-instances?startDate=2026-09-07&endDate=2026-09-07',
        headers: teacherHeaders
      });
      expect(
        sameDayMeetings
          .json<{ meetings: Array<{ sectionId: string; startTime: string | null }> }>()
          .meetings.filter((meeting) => meeting.sectionId === data.sectionOneId)
          .map((meeting) => meeting.startTime)
      ).toEqual(['10:00', '15:00']);
      const initial = await app.inject({
        method: 'POST',
        url: '/v1/class-meetings/upsert',
        headers: teacherHeaders,
        payload: {
          sectionId: data.sectionOneId,
          lessonId: data.lessonOneId,
          meetingDate: '2026-09-07',
          scheduledStartTime: '10:00',
          scheduledEndTime: '10:50',
          completedStepIds: [],
          rawNote: '  exact\nraw note  ',
          expectedRevision: null
        }
      });
      expect(initial.statusCode).toBe(200);
      const first = initial.json<{
        id: string;
        revision: number;
        rawNote: string;
        stepSnapshot: Array<{ title: string; order: number }>;
      }>();
      expect(first.rawNote).toBe('  exact\nraw note  ');
      expect(first.stepSnapshot).toEqual(
        expect.arrayContaining([expect.objectContaining({ title: 'Warm-up', order: 0 })])
      );
      // Reapplying the migration to a simulated pre-Phase-2 row proves that
      // old timed history receives a timed key rather than matching all blocks.
      await pool.query('UPDATE class_meetings SET occurrence_key = $1 WHERE id = $2', [
        'legacy',
        first.id
      ]);
      const migration = await readFile(
        path.join(migrationsDir, '0011_planning_and_meeting_history.sql'),
        'utf8'
      );
      await pool.query(migration);
      const backfilled = await app.inject({
        method: 'GET',
        url: `/v1/sections/${data.sectionOneId}/class-meeting?lessonId=${data.lessonOneId}&meetingDate=2026-09-07&scheduledStartTime=10%3A00`,
        headers: teacherHeaders
      });
      expect(
        backfilled.json<{ meeting: { id: string; occurrenceKey: string } | null }>().meeting
      ).toMatchObject({
        id: first.id,
        occurrenceKey: '10:00'
      });

      const checked = await app.inject({
        method: 'POST',
        url: '/v1/class-meetings/upsert',
        headers: teacherHeaders,
        payload: {
          sectionId: data.sectionOneId,
          lessonId: data.lessonOneId,
          meetingDate: '2026-09-07',
          scheduledStartTime: '10:00',
          scheduledEndTime: '10:50',
          completedStepIds: [data.stepOne, data.stepTwo],
          rawNote: '  exact\nraw note  ',
          expectedRevision: first.revision
        }
      });
      expect(checked.statusCode).toBe(200);
      const checkedPayload = checked.json<{ revision: number; completedStepIds: string[] }>();
      expect(checkedPayload.completedStepIds).toEqual([data.stepOne, data.stepTwo]);

      const unchecked = await app.inject({
        method: 'POST',
        url: '/v1/class-meetings/upsert',
        headers: teacherHeaders,
        payload: {
          sectionId: data.sectionOneId,
          lessonId: data.lessonOneId,
          meetingDate: '2026-09-07',
          scheduledStartTime: '10:00',
          scheduledEndTime: '10:50',
          completedStepIds: [data.stepOne],
          rawNote: '  exact\nraw note  ',
          expectedRevision: checkedPayload.revision,
          endClass: true
        }
      });
      expect(unchecked.statusCode).toBe(200);
      const current = unchecked.json<{
        id: string;
        revision: number;
        completedStepIds: string[];
        cumulativeCompletedStepIds: string[];
        stoppingPointStepId: string | null;
      }>();
      expect(current.id).toBe(first.id);
      expect(current.completedStepIds).toEqual([data.stepOne]);
      expect(current.cumulativeCompletedStepIds).toEqual([data.stepOne]);
      expect(current.stoppingPointStepId).toBe(data.stepTwo);

      const stale = await app.inject({
        method: 'POST',
        url: '/v1/class-meetings/upsert',
        headers: teacherHeaders,
        payload: {
          sectionId: data.sectionOneId,
          lessonId: data.lessonOneId,
          meetingDate: '2026-09-07',
          scheduledStartTime: '10:00',
          scheduledEndTime: '10:50',
          completedStepIds: [data.stepOne, data.stepTwo],
          rawNote: 'stale write',
          expectedRevision: checkedPayload.revision
        }
      });
      expect(stale.statusCode).toBe(409);

      const secondBlock = await app.inject({
        method: 'POST',
        url: '/v1/class-meetings/upsert',
        headers: teacherHeaders,
        payload: {
          sectionId: data.sectionOneId,
          lessonId: data.lessonOneId,
          meetingDate: '2026-09-07',
          scheduledStartTime: '15:00',
          scheduledEndTime: '15:50',
          completedStepIds: [data.stepTwo],
          rawNote: 'afternoon block',
          expectedRevision: null
        }
      });
      expect(secondBlock.statusCode).toBe(200);
      expect(secondBlock.json<{ id: string }>().id).not.toBe(first.id);

      const sectionTwoComplete = await app.inject({
        method: 'POST',
        url: '/v1/class-meetings/upsert',
        headers: teacherHeaders,
        payload: {
          sectionId: data.sectionTwoId,
          lessonId: data.lessonOneId,
          meetingDate: '2026-09-09',
          scheduledStartTime: '10:00',
          scheduledEndTime: '10:50',
          completedStepIds: [data.stepOne, data.stepTwo, data.stepThree],
          rawNote: 'all done',
          expectedRevision: null,
          endClass: true
        }
      });
      expect(sectionTwoComplete.statusCode).toBe(200);
      const resumeOne = await app.inject({
        method: 'GET',
        url: `/v1/sections/${data.sectionOneId}/resume`,
        headers: teacherHeaders
      });
      const resumeTwo = await app.inject({
        method: 'GET',
        url: `/v1/sections/${data.sectionTwoId}/resume`,
        headers: teacherHeaders
      });
      expect(
        resumeOne.json<{ state: { status: string; completedSegmentIds: string[] } | null }>().state
      ).toMatchObject({
        status: 'in_progress',
        completedSegmentIds: [data.stepOne, data.stepTwo]
      });
      expect(resumeTwo.json<{ lesson: { id: string } | null }>().lesson?.id).toBe(data.lessonTwoId);

      const renamed = await app.inject({
        method: 'PATCH',
        url: `/v1/segments/${data.stepOne}`,
        headers: teacherHeaders,
        payload: { title: 'Renamed warm-up', orderIndex: 2 }
      });
      expect(renamed.statusCode).toBe(200);
      const removed = await app.inject({
        method: 'DELETE',
        url: `/v1/segments/${data.stepTwo}`,
        headers: teacherHeaders
      });
      expect(removed.statusCode).toBe(200);
      const added = await app.inject({
        method: 'POST',
        url: `/v1/lessons/${data.lessonOneId}/segments`,
        headers: teacherHeaders,
        payload: { title: 'Exit ticket', description: null, durationMinutes: 5, orderIndex: 3 }
      });
      expect(added.statusCode).toBe(200);
      const afterCurriculumEdit = await app.inject({
        method: 'POST',
        url: '/v1/class-meetings/upsert',
        headers: teacherHeaders,
        payload: {
          sectionId: data.sectionOneId,
          lessonId: data.lessonOneId,
          meetingDate: '2026-09-07',
          scheduledStartTime: '10:00',
          scheduledEndTime: '10:50',
          completedStepIds: [data.stepOne],
          rawNote: '  exact\nraw note  ',
          expectedRevision: current.revision
        }
      });
      expect(afterCurriculumEdit.statusCode).toBe(200);
      const historical = await app.inject({
        method: 'GET',
        url: `/v1/sections/${data.sectionOneId}/class-meeting?lessonId=${data.lessonOneId}&meetingDate=2026-09-07&scheduledStartTime=10%3A00`,
        headers: teacherHeaders
      });
      expect(historical.statusCode).toBe(200);
      expect(
        historical.json<{
          meeting: {
            stepSnapshot: Array<{ id: string; title: string; order: number; completed: boolean }>;
          };
        }>().meeting.stepSnapshot
      ).toEqual([
        { id: data.stepOne, title: 'Warm-up', order: 0, completed: true },
        { id: data.stepTwo, title: 'Model', order: 1, completed: false },
        { id: data.stepThree, title: 'Partner Practice', order: 2, completed: false }
      ]);

      const contextBefore = await app.inject({
        method: 'GET',
        url: `/v1/sections/${data.sectionOneId}/planning-context?meetingIndex=1`,
        headers: teacherHeaders
      });
      expect(
        contextBefore.json<{
          planned: { lessonId: string } | null;
          actual: { lessonId: string } | null;
        }>()
      ).toMatchObject({
        planned: { lessonId: data.lessonTwoId },
        actual: { lessonId: data.lessonOneId }
      });
      const shifted = await app.inject({
        method: 'POST',
        url: `/v1/sections/${data.sectionOneId}/lesson-plans/shift`,
        headers: teacherHeaders,
        payload: { lessonId: data.lessonTwoId, meetingDelta: 2 }
      });
      expect(shifted.statusCode).toBe(200);
      const shiftPayload = shifted.json<{
        operationId: string;
        plans: Array<{ lessonId: string; plannedStartMeeting: number | null }>;
      }>();
      expect(shiftPayload.plans).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ lessonId: data.lessonTwoId, plannedStartMeeting: 3 })
        ])
      );
      const sectionPlans = await app.inject({
        method: 'GET',
        url: `/v1/sections/${data.sectionOneId}/lesson-plans`,
        headers: teacherHeaders
      });
      expect(sectionPlans.statusCode).toBe(200);
      expect(sectionPlans.json<{ plans: Array<{ lessonId: string }> }>().plans).toEqual(
        expect.arrayContaining([expect.objectContaining({ lessonId: data.lessonTwoId })])
      );
      const unchangedOtherSection = await app.inject({
        method: 'GET',
        url: `/v1/sections/${data.sectionTwoId}/planning-context?meetingIndex=1`,
        headers: teacherHeaders
      });
      expect(
        unchangedOtherSection.json<{ planned: { lessonId: string; source: string } | null }>()
          .planned
      ).toEqual({
        lessonId: data.lessonTwoId,
        title: 'Partner Introductions',
        plannedStartMeeting: 1,
        plannedMeetingCount: 1,
        source: 'course'
      });
      const undo = await app.inject({
        method: 'POST',
        url: `/v1/sections/${data.sectionOneId}/lesson-plans/${shiftPayload.operationId}/undo`,
        headers: teacherHeaders
      });
      expect(undo.statusCode).toBe(200);
      expect(undo.json<{ plans: unknown[] }>().plans).toEqual([]);

      const firstStackedShift = await app.inject({
        method: 'POST',
        url: `/v1/sections/${data.sectionOneId}/lesson-plans/shift`,
        headers: teacherHeaders,
        payload: { lessonId: data.lessonTwoId, meetingDelta: 1 }
      });
      const secondStackedShift = await app.inject({
        method: 'POST',
        url: `/v1/sections/${data.sectionOneId}/lesson-plans/shift`,
        headers: teacherHeaders,
        payload: { lessonId: data.lessonTwoId, meetingDelta: 1 }
      });
      expect(firstStackedShift.statusCode).toBe(200);
      expect(secondStackedShift.statusCode).toBe(200);
      const firstOperationId = firstStackedShift.json<{ operationId: string }>().operationId;
      const secondOperationId = secondStackedShift.json<{ operationId: string }>().operationId;
      const outOfOrderUndo = await app.inject({
        method: 'POST',
        url: `/v1/sections/${data.sectionOneId}/lesson-plans/${firstOperationId}/undo`,
        headers: teacherHeaders
      });
      expect(outOfOrderUndo.statusCode).toBe(409);
      const undoSecond = await app.inject({
        method: 'POST',
        url: `/v1/sections/${data.sectionOneId}/lesson-plans/${secondOperationId}/undo`,
        headers: teacherHeaders
      });
      const undoFirst = await app.inject({
        method: 'POST',
        url: `/v1/sections/${data.sectionOneId}/lesson-plans/${firstOperationId}/undo`,
        headers: teacherHeaders
      });
      expect(undoSecond.statusCode).toBe(200);
      expect(undoFirst.statusCode).toBe(200);
      expect(undoFirst.json<{ plans: unknown[] }>().plans).toEqual([]);

      // Distinct periods for the same section/lesson may save at the same time.
      // The aggregate lock must preserve both completions rather than allowing
      // a last writer to erase the other period's progress.
      const concurrentOccurrences = await Promise.all(
        [
          { scheduledStartTime: '10:00', completedStepIds: [data.lessonTwoStepOne] },
          { scheduledStartTime: '14:00', completedStepIds: [data.lessonTwoStepTwo] }
        ].map(({ scheduledStartTime, completedStepIds }) =>
          app.inject({
            method: 'POST',
            url: '/v1/class-meetings/upsert',
            headers: teacherHeaders,
            payload: {
              sectionId: data.sectionOneId,
              lessonId: data.lessonTwoId,
              meetingDate: '2026-09-14',
              scheduledStartTime,
              scheduledEndTime: scheduledStartTime === '10:00' ? '10:50' : '14:50',
              completedStepIds,
              rawNote: null,
              expectedRevision: null
            }
          })
        )
      );
      expect(concurrentOccurrences.map((result) => result.statusCode)).toEqual([200, 200]);
      const concurrentLookup = await app.inject({
        method: 'GET',
        url: `/v1/sections/${data.sectionOneId}/class-meeting?lessonId=${data.lessonTwoId}&meetingDate=2026-09-14&scheduledStartTime=10%3A00`,
        headers: teacherHeaders
      });
      expect(
        concurrentLookup.json<{ meeting: { cumulativeCompletedStepIds: string[] } | null }>()
          .meeting?.cumulativeCompletedStepIds
      ).toEqual(expect.arrayContaining([data.lessonTwoStepOne, data.lessonTwoStepTwo]));
    });

    it('rolls back meeting history and section state when a transactional companion write fails', async () => {
      const data = await fixture();
      await pool.query(`
        CREATE OR REPLACE FUNCTION integration_fail_class_note() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'forced class note failure'; END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER integration_fail_class_note_trigger
        BEFORE INSERT ON class_notes FOR EACH ROW EXECUTE FUNCTION integration_fail_class_note();
      `);
      try {
        const failed = await app.inject({
          method: 'POST',
          url: '/v1/class-meetings/upsert',
          headers: teacherHeaders,
          payload: {
            sectionId: data.sectionOneId,
            lessonId: data.lessonOneId,
            meetingDate: '2026-09-07',
            scheduledStartTime: '10:00',
            scheduledEndTime: '10:50',
            completedStepIds: [data.stepOne],
            rawNote: 'this transaction must fail',
            expectedRevision: null
          }
        });
        expect(failed.statusCode).toBe(500);
      } finally {
        await pool.query(
          'DROP TRIGGER IF EXISTS integration_fail_class_note_trigger ON class_notes;'
        );
        await pool.query('DROP FUNCTION IF EXISTS integration_fail_class_note();');
      }
      const lookup = await app.inject({
        method: 'GET',
        url: `/v1/sections/${data.sectionOneId}/class-meeting?lessonId=${data.lessonOneId}&meetingDate=2026-09-07&scheduledStartTime=10%3A00`,
        headers: teacherHeaders
      });
      expect(lookup.statusCode).toBe(200);
      expect(lookup.json<{ meeting: null }>().meeting).toBeNull();
      const resume = await app.inject({
        method: 'GET',
        url: `/v1/sections/${data.sectionOneId}/resume`,
        headers: teacherHeaders
      });
      expect(resume.json<{ state: null }>().state).toBeNull();
    });

    it('carries legacy progress forward as a baseline without allowing it to overwrite history', async () => {
      const data = await fixture();
      const baseline = await app.inject({
        method: 'POST',
        url: '/v1/lesson-progress/upsert',
        headers: teacherHeaders,
        payload: {
          sectionId: data.sectionOneId,
          lessonId: data.lessonOneId,
          status: 'in_progress',
          currentSegmentId: data.stepTwo,
          stoppedAtSegmentId: data.stepTwo,
          completedSegmentIds: [data.stepOne],
          carryOverNote: 'legacy baseline',
          lastTaughtDate: '2026-09-01'
        }
      });
      expect(baseline.statusCode).toBe(200);
      const meeting = await app.inject({
        method: 'POST',
        url: '/v1/class-meetings/upsert',
        headers: teacherHeaders,
        payload: {
          sectionId: data.sectionOneId,
          lessonId: data.lessonOneId,
          meetingDate: '2026-09-07',
          scheduledStartTime: '10:00',
          scheduledEndTime: '10:50',
          completedStepIds: [data.stepTwo],
          rawNote: 'first history record',
          expectedRevision: null
        }
      });
      expect(meeting.statusCode).toBe(200);
      expect(
        meeting.json<{ cumulativeCompletedStepIds: string[] }>().cumulativeCompletedStepIds
      ).toEqual(expect.arrayContaining([data.stepOne, data.stepTwo]));
      const rejectedLegacyOverwrite = await app.inject({
        method: 'POST',
        url: '/v1/lesson-progress/upsert',
        headers: teacherHeaders,
        payload: {
          sectionId: data.sectionOneId,
          lessonId: data.lessonOneId,
          status: 'in_progress',
          currentSegmentId: null,
          stoppedAtSegmentId: null,
          completedSegmentIds: [],
          carryOverNote: null,
          lastTaughtDate: '2026-09-07'
        }
      });
      expect(rejectedLegacyOverwrite.statusCode).toBe(409);
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
