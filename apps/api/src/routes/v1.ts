import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  AiJobControlResponseSchema,
  AiJobEnqueueResponseSchema,
  AiJobStatusResponseSchema,
  CalendarCommitRequestSchema,
  CalendarCommitResponseSchema,
  CalendarImportRequestSchema,
  CalendarImportResponseSchema,
  ClassroomResumeResponseSchema,
  ClassNotesUpsertRequestSchema,
  ClassNotesUpsertResponseSchema,
  CreateUploadUrlRequestSchema,
  CreateUploadUrlResponseSchema,
  CourseCreateRequestSchema,
  CourseDetailResponseSchema,
  CourseListResponseSchema,
  CourseOrderUpdateRequestSchema,
  CourseUpdateRequestSchema,
  DashboardTodayResponseSchema,
  DeleteEntityResponseSchema,
  FeedbackSubmitRequestSchema,
  FeedbackSubmitResponseSchema,
  GenerateContinuityRequestSchema,
  GenerateContinuityResponseSchema,
  GenerateSegmentsRequestSchema,
  GenerateSegmentsResponseSchema,
  GenerateUnitDraftRequestSchema,
  GenerateUnitDraftResponseSchema,
  GetScheduleResponseSchema,
  HolidaysUpsertRequestSchema,
  HolidaysUpsertResponseSchema,
  LessonProgressUpsertRequestSchema,
  LessonProgressUpsertResponseSchema,
  OnboardingRequestSchema,
  OnboardingResponseSchema,
  ParseScheduleResponseSchema,
  ProfileResponseSchema,
  ProfileUpdateRequestSchema,
  ProfileUpdateResponseSchema,
  SegmentCreateRequestSchema,
  SegmentUpdateRequestSchema,
  ScheduleImportRequestSchema,
  ScheduleImportCorrectionRequestSchema,
  ScheduleImportApplyRequestSchema,
  ScheduleImportResponseSchema,
  SectionMutationRequestSchema,
  SectionUpdateRequestSchema,
  UnitCreateRequestSchema,
  UnitUpdateRequestSchema,
  LessonCreateRequestSchema,
  LessonUpdateRequestSchema,
  MeetingInstancesQuerySchema,
  MeetingInstancesResponseSchema,
  SchoolCalendarResponseSchema,
  SchoolYearUpsertRequestSchema,
  SectionMeetingOverrideRequestSchema,
  TeacherPreferencesSchema,
  TeacherPreferencesUpdateRequestSchema,
  UuidSchema
} from '@teacheros/contracts';
import {
  aiJobs,
  aiOutputs,
  auditEvents,
  classNotes,
  courses,
  db,
  lessonSegments,
  lessons,
  schoolCalendarEvents,
  schoolHolidays,
  schoolYears,
  sectionMeetingOverrides,
  sectionLessonState,
  sectionMeetings,
  sections,
  schools,
  teacherProfiles,
  teacherPreferences,
  units,
  users
} from '@teacheros/db';

import { runStructuredPrompt } from '../lib/openai.js';
import { safeRedisGet, safeRedisSet } from '../lib/redis.js';
import { createS3Client, createSignedUploadUrl } from '../lib/s3.js';
import { AI_JOB_MAX_ATTEMPTS, enqueueAiJob } from '../lib/queue.js';
import { ensureUserFromPrincipal, upsertOnboarding } from '../services/user-service.js';
import { buildMeetingInstances, loadActiveSchoolYear } from '../services/meeting-instances.js';

const InternalParseScheduleSchema = z.object({
  classes: z.array(
    z.object({
      name: z.string(),
      period: z.string(),
      days: z.array(z.string()),
      time: z.string().nullable(),
      room: z.string().nullable(),
      subject: z.string(),
      grade: z.string().default('')
    })
  ),
  assignments: z.array(
    z.object({
      name: z.string(),
      courseName: z.string(),
      dueDate: z.string().nullable(),
      description: z.string().nullable()
    })
  )
});

const InternalParseCalendarSchema = z.object({
  schoolYear: z.object({ startDate: z.string(), endDate: z.string() }),
  events: z.array(
    z.object({
      date: z.string(),
      type: z.enum([
        'no_school',
        'minimum_day',
        'half_day',
        'testing',
        'special_schedule',
        'other'
      ]),
      label: z.string(),
      confidence: z.number().int().min(0).max(100).default(70),
      sourceText: z.string().nullable().default(null)
    })
  ),
  overrides: z
    .array(
      z.object({
        date: z.string(),
        classGroup: z.string(),
        startTime: z.string().nullable(),
        endTime: z.string().nullable(),
        room: z.string().nullable(),
        cancelled: z.boolean().default(false)
      })
    )
    .default([]),
  notices: z.array(z.string()).default([])
});

type ScheduleImportBody = z.infer<typeof ScheduleImportRequestSchema>;
type ScheduleImportCorrectionBody = z.infer<typeof ScheduleImportCorrectionRequestSchema>;

function hasScheduleImportInput(body: ScheduleImportBody): boolean {
  return Boolean(body.text || body.imageBase64 || body.fileBase64);
}

function scheduleImportFileDataUrl(body: ScheduleImportBody): string | undefined {
  if (body.fileBase64) {
    if (body.fileBase64.startsWith('data:')) return body.fileBase64;
    return `data:${body.fileMimeType ?? 'application/pdf'};base64,${body.fileBase64}`;
  }

  if (body.imageBase64) {
    if (body.imageBase64.startsWith('data:')) return body.imageBase64;
    return `data:${body.fileMimeType ?? 'image/png'};base64,${body.imageBase64}`;
  }

  return undefined;
}

function calendarImportPrompt(body: ScheduleImportBody, classGroups: string[]): string {
  const instructions = [
    'Parse this as a school-year calendar only. Do not extract or change recurring classes, courses, or class groups.',
    'Return a structured school year plus one event per actual date. Expand every date range into daily events.',
    'Infer a missing end year when a range crosses December into January. Use no_school only when classes do not meet; minimum_day, half_day, testing, and special_schedule are still school days.',
    'For every event include the visible label, a 0-100 confidence, and a compact source excerpt. Do not invent alternate bell times when the source only names a special day.',
    classGroups.length
      ? `If an alternate schedule explicitly identifies one of these Class Groups, emit a date-specific override for it: ${classGroups.join(', ')}.`
      : 'Do not emit an override unless the alternate schedule identifies a class group.',
    'Return JSON only.'
  ];
  return body.text ? [...instructions, '', body.text].join('\n') : instructions.join('\n');
}

function calendarEventKey(event: { date: string; type: string; label: string }) {
  return `${event.date}|${event.type}|${importNameKey(event.label)}`;
}

function scheduleImportUserPrompt(body: ScheduleImportBody): string {
  if (body.text) {
    return [
      'Parse this teacher schedule and assignments.',
      'Before returning JSON, compare every class title. Separate trailing A/B/C letters and Block, Period, Section, or Group numbers are class-group labels—not separate curricula—when their remaining course title matches.',
      'Examples: Spanish 5A, Spanish 5B, and Spanish 5C are one course named Spanish 5. Pre-Calculus Block 1, Block 3, and Block 4 are one course named Pre-Calculus.',
      'A schedule may show the same class group on more than one day at different times. Emit one class object per meeting occurrence, but repeat the exact same course name and class-group label for every occurrence of that group.',
      'The `period` field is the class-group label, not the grid row or bell-period number. For example, Spanish 5B on Monday at 08:10–09:05 and Thursday at 13:35–14:30 must both use `name: "Spanish 5"` and `period: "Group B"`; only `days`, `time` (start), and `endTime` change.',
      'Extract both a `time` start time and `endTime` whenever they are visible. If only a start time is visible, use null for `endTime`; TeacherDesk will ask for or safely infer the end time during review.',
      'For a visual grid, audit every nonempty teaching cell across all weekday columns before returning. A shorthand such as 7B means Spanish 7, Group B; text in parentheses such as a homeroom teacher is the room/location. Do not omit a group just because another group from the same grade appears elsewhere.',
      'Keep each class group and all of its meeting times. Return JSON only.',
      '',
      body.text
    ].join('\n');
  }
  if (body.fileMimeType === 'application/pdf' || body.fileName?.toLowerCase().endsWith('.pdf')) {
    return 'Parse the uploaded PDF schedule. Extract teaching classes and assignments. Return JSON only.';
  }
  return 'Parse the uploaded schedule image. Extract teaching classes and assignments. Return JSON only.';
}

function scheduleImportCorrectionPrompt(body: ScheduleImportCorrectionBody): string {
  return [
    'Correct this already-parsed teacher schedule according to the teacher instruction.',
    'The `name` field is the shared course curriculum. The `period` field is a distinct class-group label under that course, never a bell-period number.',
    'When one class group meets at more than one time, return one class object per meeting occurrence with the same `name` and `period`; the app will combine them into one group with multiple meeting times.',
    'Keep every class group, its meeting days, start time (`time`), end time (`endTime`), room, subject, grade, and assignments unless the instruction explicitly changes one.',
    'When an instruction changes a class group, start time, end time, day, room, or course name, return only the corrected replacement. Never return both the old and corrected versions, and never duplicate a meeting occurrence.',
    'When the teacher says groups or periods share a course, update their `name` fields to the shared course while retaining separate `period` entries.',
    'Return the complete corrected schedule as JSON only, not a partial patch.',
    '',
    `Teacher instruction: ${body.instruction}`,
    '',
    `Current schedule: ${JSON.stringify({ classes: body.classes, assignments: body.assignments })}`
  ].join('\n');
}

function scheduleImportAuditPrompt(
  body: ScheduleImportBody,
  initialExtraction: z.infer<typeof InternalParseScheduleSchema>
): string {
  return [
    'Audit the attached schedule image against the candidate extraction below. Return a complete corrected JSON schedule.',
    'Make a row-and-column pass through every weekday. Preserve all valid candidate records, add any omitted class group, and split a group into separate records whenever it meets at different times on different days.',
    'A class-group label is never a bell-period row. Keep the same `name` and `period` for repeated meetings of one group. For example, if Spanish 5B is Monday 08:10 and Thursday 13:35, return two records with `name: "Spanish 5"`, `period: "Group B"`—do not combine those days under one time.',
    'Use the visible text in parentheses as the room/location when present. Ignore lunch, homeroom, breaks, planning, Mass, and dismissal.',
    '',
    `Candidate extraction: ${JSON.stringify(initialExtraction)}`,
    body.text ? `\nOriginal text, if helpful:\n${body.text}` : ''
  ].join('\n');
}

function requirePrincipal(request: FastifyRequest, reply: FastifyReply) {
  if (!request.principal) {
    reply.code(401).send({ error: 'Unauthorized', requestId: request.id });
    return null;
  }
  return request.principal;
}

function dateToIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function importNameKey(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function timeToMinutes(time: string | null): number | null {
  if (!time) return null;
  const parts = time.split(':');
  const hours = Number(parts[0] ?? Number.NaN);
  const minutes = Number(parts[1] ?? Number.NaN);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function endTimeFromStart(startTime: string | null): string | null {
  const startMinutes = timeToMinutes(startTime);
  if (startMinutes === null) return null;
  const endMinutes = (startMinutes + 55) % (24 * 60);
  return `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
}

function isInSession(startTime: string | null, endTime: string | null): boolean {
  const startMinutes = timeToMinutes(startTime);
  if (startMinutes === null) return false;
  const endMinutes = timeToMinutes(endTime ?? endTimeFromStart(startTime));
  if (endMinutes === null) return false;

  const now = new Date();
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return nowMinutes >= startMinutes && nowMinutes < endMinutes;
}

async function loadTeacherSchoolId(userId: string): Promise<string> {
  const [profile] = await db
    .select({ schoolId: teacherProfiles.schoolId })
    .from(teacherProfiles)
    .where(eq(teacherProfiles.userId, userId))
    .limit(1);

  if (!profile) {
    throw new Error('Teacher profile not found. Complete onboarding first.');
  }
  return profile.schoolId;
}

async function buildSchoolCalendarResponse(schoolId: string, requestedSchoolYearId?: string) {
  const schoolYear = requestedSchoolYearId
    ? ((
        await db
          .select()
          .from(schoolYears)
          .where(and(eq(schoolYears.id, requestedSchoolYearId), eq(schoolYears.schoolId, schoolId)))
          .limit(1)
      )[0] ?? null)
    : await loadActiveSchoolYear(schoolId);
  const events = schoolYear
    ? await db
        .select()
        .from(schoolCalendarEvents)
        .where(eq(schoolCalendarEvents.schoolYearId, schoolYear.id))
        .orderBy(asc(schoolCalendarEvents.date), asc(schoolCalendarEvents.label))
    : [];

  return SchoolCalendarResponseSchema.parse({
    schoolYear: schoolYear
      ? { id: schoolYear.id, startDate: schoolYear.startDate, endDate: schoolYear.endDate }
      : null,
    events: events.map((event) => ({
      id: event.id,
      date: event.date,
      type: event.type,
      label: event.label,
      confidence: event.confidence,
      sourceText: event.sourceText
    })),
    isShared: true
  });
}

async function findOrCreateSchoolYear(
  schoolId: string,
  userId: string,
  dates: { startDate: string; endDate: string }
) {
  const [existing] = await db
    .select()
    .from(schoolYears)
    .where(
      and(
        eq(schoolYears.schoolId, schoolId),
        eq(schoolYears.startDate, dates.startDate),
        eq(schoolYears.endDate, dates.endDate)
      )
    )
    .limit(1);
  if (existing) return { schoolYear: existing, created: false };

  const [schoolYear] = await db
    .insert(schoolYears)
    .values({ schoolId, ...dates, createdByUserId: userId })
    .returning();
  if (!schoolYear) throw new Error('Could not create school year');
  return { schoolYear, created: true };
}

async function buildTeacherPreferences(userId: string) {
  const [preferences] = await db
    .select()
    .from(teacherPreferences)
    .where(eq(teacherPreferences.userId, userId))
    .limit(1);
  return TeacherPreferencesSchema.parse({
    walkthroughDismissed: preferences?.walkthroughDismissed ?? false,
    setupStep: preferences?.setupStep ?? 'schedule',
    returnPath: preferences?.returnPath ?? null
  });
}

const CourseParamsSchema = z.object({ courseId: UuidSchema });
const UnitParamsSchema = z.object({ unitId: UuidSchema });
const LessonParamsSchema = z.object({ lessonId: UuidSchema });
const SegmentParamsSchema = z.object({ segmentId: UuidSchema });
const SectionParamsSchema = z.object({ sectionId: UuidSchema });
const HolidayParamsSchema = z.object({ holidayId: UuidSchema });
const AiJobParamsSchema = z.object({ jobId: UuidSchema });

async function findOwnedCourse(userId: string, courseId: string) {
  const [course] = await db
    .select({
      id: courses.id,
      name: courses.name,
      subject: courses.subject,
      gradeLevel: courses.gradeLevel,
      sortIndex: courses.sortIndex,
      createdAt: courses.createdAt
    })
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.teacherId, userId)))
    .limit(1);
  return course ?? null;
}

async function findOwnedCourseIdForUnit(userId: string, unitId: string) {
  const [row] = await db
    .select({
      courseId: units.courseId
    })
    .from(units)
    .innerJoin(courses, eq(units.courseId, courses.id))
    .where(and(eq(units.id, unitId), eq(courses.teacherId, userId)))
    .limit(1);

  return row?.courseId ?? null;
}

async function findOwnedCourseIdForLesson(userId: string, lessonId: string) {
  const [row] = await db
    .select({
      courseId: units.courseId
    })
    .from(lessons)
    .innerJoin(units, eq(lessons.unitId, units.id))
    .innerJoin(courses, eq(units.courseId, courses.id))
    .where(and(eq(lessons.id, lessonId), eq(courses.teacherId, userId)))
    .limit(1);

  return row?.courseId ?? null;
}

async function findOwnedCourseIdForSegment(userId: string, segmentId: string) {
  const [row] = await db
    .select({
      courseId: units.courseId
    })
    .from(lessonSegments)
    .innerJoin(lessons, eq(lessonSegments.lessonId, lessons.id))
    .innerJoin(units, eq(lessons.unitId, units.id))
    .innerJoin(courses, eq(units.courseId, courses.id))
    .where(and(eq(lessonSegments.id, segmentId), eq(courses.teacherId, userId)))
    .limit(1);

  return row?.courseId ?? null;
}

async function findOwnedSection(userId: string, sectionId: string) {
  const [row] = await db
    .select({
      sectionId: sections.id,
      sectionName: sections.name,
      courseId: courses.id,
      courseName: courses.name
    })
    .from(sections)
    .innerJoin(courses, eq(sections.courseId, courses.id))
    .where(and(eq(sections.id, sectionId), eq(courses.teacherId, userId)))
    .limit(1);

  return row ?? null;
}

async function findOwnedLessonInSectionCourse(userId: string, sectionId: string, lessonId: string) {
  const [row] = await db
    .select({
      sectionId: sections.id,
      lessonId: lessons.id
    })
    .from(sections)
    .innerJoin(courses, eq(sections.courseId, courses.id))
    .innerJoin(units, eq(units.courseId, courses.id))
    .innerJoin(lessons, eq(lessons.unitId, units.id))
    .where(and(eq(sections.id, sectionId), eq(lessons.id, lessonId), eq(courses.teacherId, userId)))
    .limit(1);

  return row ?? null;
}

async function buildScheduleResponse(userId: string, schoolId: string) {
  const rows = await db
    .select({
      sectionId: sections.id,
      sectionName: sections.name,
      courseId: courses.id,
      courseName: courses.name,
      day: sectionMeetings.day,
      meetingTime: sectionMeetings.meetingTime,
      endTime: sectionMeetings.endTime,
      room: sectionMeetings.room
    })
    .from(sections)
    .innerJoin(courses, eq(sections.courseId, courses.id))
    .leftJoin(sectionMeetings, eq(sectionMeetings.sectionId, sections.id))
    .where(eq(courses.teacherId, userId));

  const holidayRows = await db
    .select({
      id: schoolHolidays.id,
      date: schoolHolidays.date,
      name: schoolHolidays.name
    })
    .from(schoolHolidays)
    .where(eq(schoolHolidays.schoolId, schoolId))
    .orderBy(asc(schoolHolidays.date));

  const bySection = new Map<
    string,
    {
      sectionId: string;
      courseId: string;
      courseName: string;
      sectionName: string;
      meetings: Array<{
        day: string;
        time: string | null;
        endTime: string | null;
        room: string | null;
      }>;
    }
  >();

  rows.forEach((row) => {
    if (!bySection.has(row.sectionId)) {
      bySection.set(row.sectionId, {
        sectionId: row.sectionId,
        courseId: row.courseId,
        courseName: row.courseName,
        sectionName: row.sectionName,
        meetings: []
      });
    }

    if (row.day) {
      bySection.get(row.sectionId)?.meetings.push({
        day: row.day,
        time: row.meetingTime ? row.meetingTime.slice(0, 5) : null,
        endTime: row.endTime
          ? row.endTime.slice(0, 5)
          : endTimeFromStart(row.meetingTime ? row.meetingTime.slice(0, 5) : null),
        room: row.room
      });
    }
  });

  return GetScheduleResponseSchema.parse({
    sections: Array.from(bySection.values()),
    holidays: holidayRows.map((row) => ({ id: row.id, date: row.date, name: row.name }))
  });
}

async function buildCourseDetail(userId: string, courseId: string) {
  const course = await findOwnedCourse(userId, courseId);
  if (!course) return null;

  const unitRows = await db
    .select({
      id: units.id,
      title: units.title,
      description: units.description,
      orderIndex: units.orderIndex,
      plannedStartMeeting: units.plannedStartMeeting,
      plannedMeetingCount: units.plannedMeetingCount
    })
    .from(units)
    .where(eq(units.courseId, courseId))
    .orderBy(asc(units.orderIndex), asc(units.createdAt));

  const unitIds = unitRows.map((unit) => unit.id);
  const lessonRows =
    unitIds.length > 0
      ? await db
          .select({
            id: lessons.id,
            unitId: lessons.unitId,
            title: lessons.title,
            description: lessons.description,
            orderIndex: lessons.orderIndex,
            estimatedDurationMinutes: lessons.estimatedDurationMinutes,
            plannedStartMeeting: lessons.plannedStartMeeting,
            plannedMeetingCount: lessons.plannedMeetingCount
          })
          .from(lessons)
          .where(inArray(lessons.unitId, unitIds))
          .orderBy(asc(lessons.orderIndex), asc(lessons.createdAt))
      : [];

  const lessonIds = lessonRows.map((lesson) => lesson.id);
  const segmentRows =
    lessonIds.length > 0
      ? await db
          .select({
            id: lessonSegments.id,
            lessonId: lessonSegments.lessonId,
            title: lessonSegments.title,
            description: lessonSegments.description,
            durationMinutes: lessonSegments.durationMinutes,
            orderIndex: lessonSegments.orderIndex
          })
          .from(lessonSegments)
          .where(inArray(lessonSegments.lessonId, lessonIds))
          .orderBy(asc(lessonSegments.orderIndex), asc(lessonSegments.createdAt))
      : [];

  const segmentsByLessonId = new Map<string, typeof segmentRows>();
  segmentRows.forEach((segment) => {
    const existing = segmentsByLessonId.get(segment.lessonId);
    if (existing) {
      existing.push(segment);
      return;
    }
    segmentsByLessonId.set(segment.lessonId, [segment]);
  });

  const lessonsByUnitId = new Map<string, typeof lessonRows>();
  lessonRows.forEach((lesson) => {
    const existing = lessonsByUnitId.get(lesson.unitId);
    if (existing) {
      existing.push(lesson);
      return;
    }
    lessonsByUnitId.set(lesson.unitId, [lesson]);
  });

  return CourseDetailResponseSchema.parse({
    course: {
      id: course.id,
      name: course.name,
      subject: course.subject,
      gradeLevel: course.gradeLevel,
      sortIndex: course.sortIndex,
      createdAt: course.createdAt.toISOString(),
      units: unitRows.map((unit) => ({
        id: unit.id,
        title: unit.title,
        description: unit.description,
        orderIndex: unit.orderIndex,
        plannedStartMeeting: unit.plannedStartMeeting,
        plannedMeetingCount: unit.plannedMeetingCount,
        lessons: (lessonsByUnitId.get(unit.id) ?? []).map((lesson) => ({
          id: lesson.id,
          title: lesson.title,
          description: lesson.description,
          orderIndex: lesson.orderIndex,
          estimatedDurationMinutes: lesson.estimatedDurationMinutes,
          plannedStartMeeting: lesson.plannedStartMeeting,
          plannedMeetingCount: lesson.plannedMeetingCount,
          segments: (segmentsByLessonId.get(lesson.id) ?? []).map((segment) => ({
            id: segment.id,
            title: segment.title,
            description: segment.description,
            durationMinutes: segment.durationMinutes,
            orderIndex: segment.orderIndex
          }))
        }))
      }))
    }
  });
}

function normalizeProgressPercent(progress: unknown): number | null {
  if (typeof progress === 'number' && Number.isFinite(progress)) {
    return Math.max(0, Math.min(100, Math.round(progress)));
  }

  if (
    typeof progress === 'object' &&
    progress !== null &&
    'percent' in progress &&
    typeof progress.percent === 'number' &&
    Number.isFinite(progress.percent)
  ) {
    return Math.max(0, Math.min(100, Math.round(progress.percent)));
  }

  return null;
}

export async function v1Routes(app: FastifyInstance) {
  app.post(
    '/v1/onboarding',
    {
      schema: {
        body: OnboardingRequestSchema,
        response: {
          200: OnboardingResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      const body = OnboardingRequestSchema.parse(request.body);
      const result = await upsertOnboarding(principal, body);
      return {
        userId: result.userId,
        schoolId: result.schoolId,
        onboarded: true
      };
    }
  );

  app.get(
    '/v1/profile',
    {
      schema: {
        response: {
          200: ProfileResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      const user = await ensureUserFromPrincipal(principal);
      const [row] = await db
        .select({
          userId: users.id,
          email: users.email,
          fullName: users.fullName,
          role: teacherProfiles.role,
          phone: teacherProfiles.phone,
          workEmail: teacherProfiles.workEmail,
          subjects: teacherProfiles.subjects,
          grades: teacherProfiles.grades,
          onboarded: teacherProfiles.onboarded,
          schoolId: schools.id,
          schoolName: schools.name,
          district: schools.district,
          state: schools.state
        })
        .from(users)
        .leftJoin(teacherProfiles, eq(teacherProfiles.userId, users.id))
        .leftJoin(schools, eq(schools.id, teacherProfiles.schoolId))
        .where(eq(users.id, user.id))
        .limit(1);

      return ProfileResponseSchema.parse({
        user: {
          id: user.id,
          email: row?.email ?? user.email,
          fullName: row?.fullName ?? null
        },
        profile:
          row?.role && row.onboarded !== null
            ? {
                role: row.role,
                phone: row.phone,
                workEmail: row.workEmail,
                subjects: row.subjects ?? [],
                grades: row.grades ?? [],
                onboarded: row.onboarded
              }
            : null,
        school:
          row?.schoolId && row.schoolName
            ? {
                id: row.schoolId,
                name: row.schoolName,
                district: row.district,
                state: row.state
              }
            : null
      });
    }
  );

  app.patch(
    '/v1/profile',
    {
      schema: {
        body: ProfileUpdateRequestSchema,
        response: {
          200: ProfileUpdateResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      const body = ProfileUpdateRequestSchema.parse(request.body);
      await upsertOnboarding(principal, body);

      const user = await ensureUserFromPrincipal(principal);
      const [row] = await db
        .select({
          userId: users.id,
          email: users.email,
          fullName: users.fullName,
          role: teacherProfiles.role,
          phone: teacherProfiles.phone,
          workEmail: teacherProfiles.workEmail,
          subjects: teacherProfiles.subjects,
          grades: teacherProfiles.grades,
          onboarded: teacherProfiles.onboarded,
          schoolId: schools.id,
          schoolName: schools.name,
          district: schools.district,
          state: schools.state
        })
        .from(users)
        .leftJoin(teacherProfiles, eq(teacherProfiles.userId, users.id))
        .leftJoin(schools, eq(schools.id, teacherProfiles.schoolId))
        .where(eq(users.id, user.id))
        .limit(1);

      return ProfileUpdateResponseSchema.parse({
        user: {
          id: user.id,
          email: row?.email ?? user.email,
          fullName: row?.fullName ?? null
        },
        profile: row?.role
          ? {
              role: row.role,
              phone: row.phone,
              workEmail: row.workEmail,
              subjects: row.subjects ?? [],
              grades: row.grades ?? [],
              onboarded: row.onboarded ?? true
            }
          : null,
        school:
          row?.schoolId && row.schoolName
            ? {
                id: row.schoolId,
                name: row.schoolName,
                district: row.district,
                state: row.state
              }
            : null
      });
    }
  );

  app.get(
    '/v1/dashboard/today',
    {
      schema: {
        response: {
          200: DashboardTodayResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      const user = await ensureUserFromPrincipal(principal);
      const date = new Date();
      const isoDate = dateToIso(date);
      const cacheKey = `dashboard:today:v2:${user.id}:${isoDate}`;

      const cached = await safeRedisGet(app.redis, cacheKey);
      if (cached) {
        return JSON.parse(cached) as unknown;
      }

      const schoolId = await loadTeacherSchoolId(user.id);
      const allMeetingInstances = await buildMeetingInstances(user.id, schoolId, {
        startDate: isoDate,
        endDate: isoDate
      });
      const todaySchedule = allMeetingInstances.meetings.map((meeting) => ({
        sectionId: meeting.sectionId,
        sectionName: meeting.sectionName,
        courseName: meeting.courseName,
        meetingTime: meeting.startTime,
        endTime: meeting.endTime,
        room: meeting.room,
        isInSession: isInSession(meeting.startTime, meeting.endTime)
      }));
      const activeYear = await loadActiveSchoolYear(schoolId);
      const [calendarClosure] = activeYear
        ? await db
            .select({
              id: schoolCalendarEvents.id,
              date: schoolCalendarEvents.date,
              name: schoolCalendarEvents.label
            })
            .from(schoolCalendarEvents)
            .where(
              and(
                eq(schoolCalendarEvents.schoolYearId, activeYear.id),
                eq(schoolCalendarEvents.date, isoDate),
                eq(schoolCalendarEvents.type, 'no_school')
              )
            )
            .limit(1)
        : [];

      const nowMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
      const withMinutes = todaySchedule.map((entry) => ({
        ...entry,
        startMinutes: timeToMinutes(entry.meetingTime) ?? Number.MAX_SAFE_INTEGER,
        endMinutes: timeToMinutes(entry.endTime) ?? Number.MAX_SAFE_INTEGER
      }));

      const currentClass = withMinutes.find(
        (entry) => nowMinutes >= entry.startMinutes && nowMinutes < entry.endMinutes
      );
      const nextClass = withMinutes.find((entry) => entry.startMinutes > nowMinutes);

      const response = {
        date: isoDate,
        currentClass: currentClass
          ? {
              sectionId: currentClass.sectionId,
              courseName: currentClass.courseName,
              sectionName: currentClass.sectionName,
              meetingTime: currentClass.meetingTime,
              endTime: currentClass.endTime,
              room: currentClass.room
            }
          : null,
        nextClass: nextClass
          ? {
              sectionId: nextClass.sectionId,
              courseName: nextClass.courseName,
              sectionName: nextClass.sectionName,
              meetingTime: nextClass.meetingTime,
              endTime: nextClass.endTime
            }
          : null,
        todaySchedule: todaySchedule.map(
          ({
            sectionId,
            courseName,
            sectionName,
            meetingTime,
            endTime,
            room,
            isInSession: inSession
          }) => ({
            sectionId,
            courseName,
            sectionName,
            meetingTime,
            endTime,
            room,
            isInSession: inSession
          })
        ),
        holiday: calendarClosure
          ? {
              id: calendarClosure.id,
              date: calendarClosure.date,
              name: calendarClosure.name
            }
          : null
      };

      await safeRedisSet(app.redis, cacheKey, JSON.stringify(response), 30);
      return response;
    }
  );

  app.get(
    '/v1/schedule',
    {
      schema: {
        response: {
          200: GetScheduleResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const schoolId = await loadTeacherSchoolId(user.id);

      return buildScheduleResponse(user.id, schoolId);
    }
  );

  app.get(
    '/v1/school-calendar',
    { schema: { response: { 200: SchoolCalendarResponseSchema } } },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      return buildSchoolCalendarResponse(await loadTeacherSchoolId(user.id));
    }
  );

  app.post(
    '/v1/school-year',
    {
      schema: {
        body: SchoolYearUpsertRequestSchema,
        response: { 200: SchoolCalendarResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const schoolId = await loadTeacherSchoolId(user.id);
      const body = SchoolYearUpsertRequestSchema.parse(request.body);
      const { schoolYear, created } = await findOrCreateSchoolYear(schoolId, user.id, body);
      await db.insert(auditEvents).values({
        userId: user.id,
        eventType: created ? 'school_year_created' : 'school_year_saved',
        entityType: 'school_year',
        entityId: schoolYear.id,
        metadata: body
      });
      return buildSchoolCalendarResponse(schoolId, schoolYear.id);
    }
  );

  app.post(
    '/v1/school-calendar/import',
    {
      schema: { body: CalendarImportRequestSchema, response: { 200: CalendarImportResponseSchema } }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const body = CalendarImportRequestSchema.parse(request.body);
      if (!hasScheduleImportInput(body)) {
        (reply as any).code(400);
        return {
          error: 'Paste calendar text or upload a calendar image/PDF',
          requestId: request.id
        };
      }
      if (!app.config.OPENAI_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENAI_API_KEY is not configured', requestId: request.id };
      }
      const classGroups = await db
        .select({ name: sections.name })
        .from(sections)
        .innerJoin(courses, eq(sections.courseId, courses.id))
        .where(eq(courses.teacherId, user.id));
      const result = await runStructuredPrompt<z.infer<typeof InternalParseCalendarSchema>>({
        apiKey: app.config.OPENAI_API_KEY,
        model: app.config.OPENAI_MODEL_PARSE_SCHEDULE,
        reasoningEffort: app.config.OPENAI_REASONING_EFFORT_PARSE_SCHEDULE,
        schemaName: 'school_calendar_import',
        schema: InternalParseCalendarSchema,
        systemPrompt:
          'You are a careful school calendar reader. Extract only evidence visible in the teacher supplied calendar.',
        userPrompt: calendarImportPrompt(
          body,
          classGroups.map((group) => group.name)
        ),
        fileDataUrl: scheduleImportFileDataUrl(body),
        fileName: body.fileName
      });
      return CalendarImportResponseSchema.parse(result);
    }
  );

  app.post(
    '/v1/school-calendar/commit',
    {
      schema: { body: CalendarCommitRequestSchema, response: { 200: CalendarCommitResponseSchema } }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const schoolId = await loadTeacherSchoolId(user.id);
      const body = CalendarCommitRequestSchema.parse(request.body);
      const { schoolYear } = await findOrCreateSchoolYear(schoolId, user.id, body.schoolYear);
      const approved = body.approvedEventKeys ? new Set(body.approvedEventKeys) : null;
      const events = body.events.filter(
        (event) => !approved || approved.has(calendarEventKey(event))
      );
      await db.transaction(async (tx) => {
        if (body.mode === 'replace')
          await tx
            .delete(schoolCalendarEvents)
            .where(eq(schoolCalendarEvents.schoolYearId, schoolYear.id));
        for (const event of events) {
          const values = {
            schoolYearId: schoolYear.id,
            date: event.date,
            type: event.type,
            label: event.label,
            confidence: event.confidence ?? null,
            sourceText: event.sourceText ?? null,
            createdByUserId: user.id
          };
          if (body.mode === 'merge') {
            await tx
              .insert(schoolCalendarEvents)
              .values(values)
              .onConflictDoUpdate({
                target: [
                  schoolCalendarEvents.schoolYearId,
                  schoolCalendarEvents.date,
                  schoolCalendarEvents.label
                ],
                set: {
                  type: event.type,
                  confidence: event.confidence ?? null,
                  sourceText: event.sourceText ?? null,
                  updatedAt: new Date()
                }
              });
          } else {
            await tx.insert(schoolCalendarEvents).values(values);
          }
        }
        const ownedSections = await tx
          .select({ id: sections.id, name: sections.name })
          .from(sections)
          .innerJoin(courses, eq(sections.courseId, courses.id))
          .where(eq(courses.teacherId, user.id));
        for (const override of body.overrides) {
          const section = ownedSections.find(
            (candidate) => importNameKey(candidate.name) === importNameKey(override.classGroup)
          );
          if (!section) continue;
          await tx
            .insert(sectionMeetingOverrides)
            .values({
              sectionId: section.id,
              date: override.date,
              startTime: override.startTime,
              endTime: override.endTime,
              room: override.room,
              cancelled: override.cancelled,
              createdByUserId: user.id
            })
            .onConflictDoUpdate({
              target: [sectionMeetingOverrides.sectionId, sectionMeetingOverrides.date],
              set: {
                startTime: override.startTime,
                endTime: override.endTime,
                room: override.room,
                cancelled: override.cancelled,
                updatedAt: new Date()
              }
            });
        }
        await tx.insert(auditEvents).values({
          userId: user.id,
          eventType: `school_calendar_${body.mode}`,
          entityType: 'school_year',
          entityId: schoolYear.id,
          metadata: { events: events.length }
        });
      });
      return buildSchoolCalendarResponse(schoolId, schoolYear.id);
    }
  );

  app.get(
    '/v1/meeting-instances',
    {
      schema: {
        querystring: MeetingInstancesQuerySchema,
        response: { 200: MeetingInstancesResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const query = MeetingInstancesQuerySchema.parse(request.query);
      return buildMeetingInstances(user.id, await loadTeacherSchoolId(user.id), query);
    }
  );

  app.get(
    '/v1/preferences',
    { schema: { response: { 200: TeacherPreferencesSchema } } },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      return buildTeacherPreferences((await ensureUserFromPrincipal(principal)).id);
    }
  );

  app.patch(
    '/v1/preferences',
    {
      schema: {
        body: TeacherPreferencesUpdateRequestSchema,
        response: { 200: TeacherPreferencesSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const body = TeacherPreferencesUpdateRequestSchema.parse(request.body);
      await db
        .insert(teacherPreferences)
        .values({ userId: user.id, ...body, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: teacherPreferences.userId,
          set: { ...body, updatedAt: new Date() }
        });
      return buildTeacherPreferences(user.id);
    }
  );

  app.post(
    '/v1/sections',
    {
      schema: {
        body: SectionMutationRequestSchema,
        response: {
          200: GetScheduleResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const schoolId = await loadTeacherSchoolId(user.id);
      const body = SectionMutationRequestSchema.parse(request.body);

      const ownedCourse = await findOwnedCourse(user.id, body.courseId);
      if (!ownedCourse) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }

      await db.transaction(async (tx) => {
        const [section] = await tx
          .insert(sections)
          .values({
            courseId: body.courseId,
            name: body.sectionName
          })
          .returning({ id: sections.id });
        if (!section) throw new Error('Failed to create section');

        if (body.meetings.length > 0) {
          await tx.insert(sectionMeetings).values(
            body.meetings.map((meeting) => ({
              sectionId: section.id,
              day: meeting.day,
              meetingTime: meeting.time,
              endTime: meeting.endTime ?? endTimeFromStart(meeting.time),
              room: meeting.room
            }))
          );
        }
      });

      return buildScheduleResponse(user.id, schoolId);
    }
  );

  app.patch(
    '/v1/sections/:sectionId',
    {
      schema: {
        params: SectionParamsSchema,
        body: SectionUpdateRequestSchema,
        response: {
          200: GetScheduleResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const schoolId = await loadTeacherSchoolId(user.id);
      const params = SectionParamsSchema.parse(request.params);
      const body = SectionUpdateRequestSchema.parse(request.body);

      const ownedSection = await findOwnedSection(user.id, params.sectionId);
      if (!ownedSection) {
        (reply as any).code(404);
        return { error: 'Section not found', requestId: request.id };
      }

      await db.transaction(async (tx) => {
        if (body.sectionName !== undefined) {
          await tx
            .update(sections)
            .set({ name: body.sectionName, updatedAt: new Date() })
            .where(eq(sections.id, params.sectionId));
        }

        if (body.meetings !== undefined) {
          await tx.delete(sectionMeetings).where(eq(sectionMeetings.sectionId, params.sectionId));
          if (body.meetings.length > 0) {
            await tx.insert(sectionMeetings).values(
              body.meetings.map((meeting) => ({
                sectionId: params.sectionId,
                day: meeting.day,
                meetingTime: meeting.time,
                endTime: meeting.endTime ?? endTimeFromStart(meeting.time),
                room: meeting.room
              }))
            );
          }
        }
      });

      return buildScheduleResponse(user.id, schoolId);
    }
  );

  app.delete(
    '/v1/sections/:sectionId',
    {
      schema: {
        params: SectionParamsSchema,
        response: {
          200: DeleteEntityResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = SectionParamsSchema.parse(request.params);

      const ownedSection = await findOwnedSection(user.id, params.sectionId);
      if (!ownedSection) {
        (reply as any).code(404);
        return { error: 'Section not found', requestId: request.id };
      }

      await db.delete(sections).where(eq(sections.id, params.sectionId));
      return { deleted: true };
    }
  );

  app.post(
    '/v1/sections/:sectionId/meeting-overrides',
    {
      schema: {
        params: SectionParamsSchema,
        body: SectionMeetingOverrideRequestSchema,
        response: { 200: MeetingInstancesResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = SectionParamsSchema.parse(request.params);
      const body = SectionMeetingOverrideRequestSchema.parse(request.body);
      if (!(await findOwnedSection(user.id, params.sectionId))) {
        (reply as any).code(404);
        return { error: 'Section not found', requestId: request.id };
      }
      await db
        .insert(sectionMeetingOverrides)
        .values({ sectionId: params.sectionId, ...body, createdByUserId: user.id })
        .onConflictDoUpdate({
          target: [sectionMeetingOverrides.sectionId, sectionMeetingOverrides.date],
          set: {
            startTime: body.startTime,
            endTime: body.endTime,
            room: body.room,
            cancelled: body.cancelled,
            updatedAt: new Date()
          }
        });
      await db.insert(auditEvents).values({
        userId: user.id,
        eventType: 'section_meeting_override_saved',
        entityType: 'section',
        entityId: params.sectionId,
        metadata: { date: body.date }
      });
      return buildMeetingInstances(user.id, await loadTeacherSchoolId(user.id), {
        sectionId: params.sectionId
      });
    }
  );

  app.get(
    '/v1/sections/:sectionId/resume',
    {
      schema: {
        params: SectionParamsSchema,
        response: {
          200: ClassroomResumeResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = SectionParamsSchema.parse(request.params);

      const ownedSection = await findOwnedSection(user.id, params.sectionId);
      if (!ownedSection) {
        (reply as any).code(404);
        return { error: 'Section not found', requestId: request.id };
      }

      const [activeState] = await db
        .select({
          stateId: sectionLessonState.id,
          lessonId: sectionLessonState.lessonId,
          status: sectionLessonState.status,
          currentSegmentId: sectionLessonState.currentSegmentId,
          stoppedAtSegmentId: sectionLessonState.stoppedAtSegmentId,
          completedSegmentIds: sectionLessonState.completedSegmentIds,
          carryOverNote: sectionLessonState.carryOverNote,
          lastTaughtDate: sectionLessonState.lastTaughtDate,
          updatedAt: sectionLessonState.updatedAt
        })
        .from(sectionLessonState)
        .innerJoin(lessons, eq(sectionLessonState.lessonId, lessons.id))
        .innerJoin(units, eq(lessons.unitId, units.id))
        .where(
          and(
            eq(sectionLessonState.sectionId, params.sectionId),
            eq(units.courseId, ownedSection.courseId),
            inArray(sectionLessonState.status, [
              'in_progress',
              'stopped_at_segment',
              'carried_over',
              'needs_reteach'
            ])
          )
        )
        .orderBy(desc(sectionLessonState.updatedAt))
        .limit(1);

      const [firstLesson] = !activeState
        ? await db
            .select({ id: lessons.id })
            .from(lessons)
            .innerJoin(units, eq(lessons.unitId, units.id))
            .where(eq(units.courseId, ownedSection.courseId))
            .orderBy(asc(units.orderIndex), asc(lessons.orderIndex), asc(lessons.createdAt))
            .limit(1)
        : [];

      const lessonId = activeState?.lessonId ?? firstLesson?.id ?? null;

      const [lesson] = lessonId
        ? await db
            .select({
              id: lessons.id,
              title: lessons.title,
              description: lessons.description,
              orderIndex: lessons.orderIndex,
              estimatedDurationMinutes: lessons.estimatedDurationMinutes
            })
            .from(lessons)
            .where(eq(lessons.id, lessonId))
            .limit(1)
        : [];

      const segmentRows = lessonId
        ? await db
            .select({
              id: lessonSegments.id,
              title: lessonSegments.title,
              description: lessonSegments.description,
              durationMinutes: lessonSegments.durationMinutes,
              orderIndex: lessonSegments.orderIndex
            })
            .from(lessonSegments)
            .where(eq(lessonSegments.lessonId, lessonId))
            .orderBy(asc(lessonSegments.orderIndex), asc(lessonSegments.createdAt))
        : [];

      const [lastNote] = await db
        .select({
          noteId: classNotes.id,
          date: classNotes.date,
          content: classNotes.content,
          updatedAt: classNotes.updatedAt
        })
        .from(classNotes)
        .where(and(eq(classNotes.sectionId, params.sectionId), eq(classNotes.userId, user.id)))
        .orderBy(desc(classNotes.date), desc(classNotes.updatedAt))
        .limit(1);

      return ClassroomResumeResponseSchema.parse({
        section: {
          sectionId: ownedSection.sectionId,
          courseId: ownedSection.courseId,
          courseName: ownedSection.courseName,
          sectionName: ownedSection.sectionName
        },
        lesson: lesson
          ? {
              id: lesson.id,
              title: lesson.title,
              description: lesson.description,
              orderIndex: lesson.orderIndex,
              estimatedDurationMinutes: lesson.estimatedDurationMinutes,
              segments: segmentRows
            }
          : null,
        state: activeState
          ? {
              stateId: activeState.stateId,
              lessonId: activeState.lessonId,
              status: activeState.status,
              currentSegmentId: activeState.currentSegmentId,
              stoppedAtSegmentId: activeState.stoppedAtSegmentId,
              completedSegmentIds: activeState.completedSegmentIds,
              carryOverNote: activeState.carryOverNote,
              lastTaughtDate: activeState.lastTaughtDate,
              updatedAt: activeState.updatedAt.toISOString()
            }
          : null,
        lastNote: lastNote
          ? {
              noteId: lastNote.noteId,
              date: lastNote.date,
              content: lastNote.content,
              updatedAt: lastNote.updatedAt.toISOString()
            }
          : null
      });
    }
  );

  app.get(
    '/v1/courses',
    {
      schema: {
        response: {
          200: CourseListResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);

      const courseRows = await db
        .select({
          id: courses.id,
          name: courses.name,
          subject: courses.subject,
          gradeLevel: courses.gradeLevel,
          sortIndex: courses.sortIndex,
          createdAt: courses.createdAt
        })
        .from(courses)
        .where(eq(courses.teacherId, user.id))
        .orderBy(asc(courses.sortIndex), asc(courses.name), asc(courses.createdAt));

      return {
        courses: courseRows.map((course) => ({
          id: course.id,
          name: course.name,
          subject: course.subject,
          gradeLevel: course.gradeLevel,
          sortIndex: course.sortIndex,
          createdAt: course.createdAt.toISOString()
        }))
      };
    }
  );

  app.patch(
    '/v1/courses/order',
    {
      schema: {
        body: CourseOrderUpdateRequestSchema,
        response: { 200: CourseListResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const body = CourseOrderUpdateRequestSchema.parse(request.body);
      const owned = await db
        .select({ id: courses.id })
        .from(courses)
        .where(and(eq(courses.teacherId, user.id), inArray(courses.id, body.courseIds)));
      if (owned.length !== body.courseIds.length) {
        (reply as any).code(404);
        return { error: 'One or more courses were not found', requestId: request.id };
      }

      await db.transaction(async (tx) => {
        await Promise.all(
          body.courseIds.map((courseId, sortIndex) =>
            tx
              .update(courses)
              .set({ sortIndex, updatedAt: new Date() })
              .where(and(eq(courses.id, courseId), eq(courses.teacherId, user.id)))
          )
        );
        await tx.insert(auditEvents).values({
          userId: user.id,
          eventType: 'course_order_saved',
          entityType: 'teacher',
          entityId: user.id,
          metadata: { courseIds: body.courseIds }
        });
      });

      const ordered = await db
        .select({
          id: courses.id,
          name: courses.name,
          subject: courses.subject,
          gradeLevel: courses.gradeLevel,
          sortIndex: courses.sortIndex,
          createdAt: courses.createdAt
        })
        .from(courses)
        .where(eq(courses.teacherId, user.id))
        .orderBy(asc(courses.sortIndex), asc(courses.name), asc(courses.createdAt));
      return {
        courses: ordered.map((course) => ({ ...course, createdAt: course.createdAt.toISOString() }))
      };
    }
  );

  app.post(
    '/v1/courses',
    {
      schema: {
        body: CourseCreateRequestSchema,
        response: {
          200: CourseDetailResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const body = CourseCreateRequestSchema.parse(request.body);
      const user = await ensureUserFromPrincipal(principal);
      const schoolId = await loadTeacherSchoolId(user.id);
      const [lastCourse] = await db
        .select({ sortIndex: courses.sortIndex })
        .from(courses)
        .where(eq(courses.teacherId, user.id))
        .orderBy(desc(courses.sortIndex))
        .limit(1);

      const [course] = await db
        .insert(courses)
        .values({
          teacherId: user.id,
          schoolId,
          name: body.name,
          subject: body.subject,
          gradeLevel: body.gradeLevel,
          sortIndex: (lastCourse?.sortIndex ?? -1) + 1
        })
        .returning({ id: courses.id });

      if (!course) throw new Error('Failed to create course');

      const detail = await buildCourseDetail(user.id, course.id);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.get(
    '/v1/courses/:courseId',
    {
      schema: {
        params: CourseParamsSchema,
        response: {
          200: CourseDetailResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = CourseParamsSchema.parse(request.params);

      const detail = await buildCourseDetail(user.id, params.courseId);
      if (!detail) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }
      return detail;
    }
  );

  app.patch(
    '/v1/courses/:courseId',
    {
      schema: {
        params: CourseParamsSchema,
        body: CourseUpdateRequestSchema,
        response: {
          200: CourseDetailResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = CourseParamsSchema.parse(request.params);
      const body = CourseUpdateRequestSchema.parse(request.body);

      const updates: Partial<typeof courses.$inferInsert> = {
        updatedAt: new Date()
      };
      if (body.name !== undefined) updates.name = body.name;
      if (body.subject !== undefined) updates.subject = body.subject;
      if (body.gradeLevel !== undefined) updates.gradeLevel = body.gradeLevel;
      if (body.sortIndex !== undefined) updates.sortIndex = body.sortIndex;

      const [updated] = await db
        .update(courses)
        .set(updates)
        .where(and(eq(courses.id, params.courseId), eq(courses.teacherId, user.id)))
        .returning({ id: courses.id });

      if (!updated) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }

      const detail = await buildCourseDetail(user.id, params.courseId);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.delete(
    '/v1/courses/:courseId',
    {
      schema: {
        params: CourseParamsSchema,
        response: {
          200: DeleteEntityResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = CourseParamsSchema.parse(request.params);

      const [deleted] = await db
        .delete(courses)
        .where(and(eq(courses.id, params.courseId), eq(courses.teacherId, user.id)))
        .returning({ id: courses.id });

      if (!deleted) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }

      return { deleted: true };
    }
  );

  app.post(
    '/v1/courses/:courseId/units',
    {
      schema: {
        params: CourseParamsSchema,
        body: UnitCreateRequestSchema,
        response: {
          200: CourseDetailResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = CourseParamsSchema.parse(request.params);
      const body = UnitCreateRequestSchema.parse(request.body);

      const ownedCourse = await findOwnedCourse(user.id, params.courseId);
      if (!ownedCourse) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }

      const [latestUnit] = await db
        .select({ orderIndex: units.orderIndex })
        .from(units)
        .where(eq(units.courseId, params.courseId))
        .orderBy(desc(units.orderIndex))
        .limit(1);

      await db.insert(units).values({
        courseId: params.courseId,
        title: body.title,
        description: body.description,
        orderIndex: body.orderIndex ?? (latestUnit?.orderIndex ?? -1) + 1,
        plannedStartMeeting: body.plannedStartMeeting ?? null,
        plannedMeetingCount: body.plannedMeetingCount ?? null
      });

      const detail = await buildCourseDetail(user.id, params.courseId);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.patch(
    '/v1/units/:unitId',
    {
      schema: {
        params: UnitParamsSchema,
        body: UnitUpdateRequestSchema,
        response: {
          200: CourseDetailResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = UnitParamsSchema.parse(request.params);
      const body = UnitUpdateRequestSchema.parse(request.body);

      const ownedCourseId = await findOwnedCourseIdForUnit(user.id, params.unitId);
      if (!ownedCourseId) {
        (reply as any).code(404);
        return { error: 'Unit not found', requestId: request.id };
      }

      const updates: Partial<typeof units.$inferInsert> = {
        updatedAt: new Date()
      };
      if (body.title !== undefined) updates.title = body.title;
      if (body.description !== undefined) updates.description = body.description;
      if (body.orderIndex !== undefined) updates.orderIndex = body.orderIndex;
      if (body.plannedStartMeeting !== undefined)
        updates.plannedStartMeeting = body.plannedStartMeeting;
      if (body.plannedMeetingCount !== undefined)
        updates.plannedMeetingCount = body.plannedMeetingCount;

      await db.update(units).set(updates).where(eq(units.id, params.unitId));

      const detail = await buildCourseDetail(user.id, ownedCourseId);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.delete(
    '/v1/units/:unitId',
    {
      schema: {
        params: UnitParamsSchema,
        response: {
          200: DeleteEntityResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = UnitParamsSchema.parse(request.params);

      const courseId = await findOwnedCourseIdForUnit(user.id, params.unitId);
      if (!courseId) {
        (reply as any).code(404);
        return { error: 'Unit not found', requestId: request.id };
      }

      await db.delete(units).where(eq(units.id, params.unitId));
      return { deleted: true };
    }
  );

  app.post(
    '/v1/units/:unitId/lessons',
    {
      schema: {
        params: UnitParamsSchema,
        body: LessonCreateRequestSchema,
        response: {
          200: CourseDetailResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = UnitParamsSchema.parse(request.params);
      const body = LessonCreateRequestSchema.parse(request.body);

      const courseId = await findOwnedCourseIdForUnit(user.id, params.unitId);
      if (!courseId) {
        (reply as any).code(404);
        return { error: 'Unit not found', requestId: request.id };
      }

      const [latestLesson] = await db
        .select({ orderIndex: lessons.orderIndex })
        .from(lessons)
        .where(eq(lessons.unitId, params.unitId))
        .orderBy(desc(lessons.orderIndex))
        .limit(1);

      await db.insert(lessons).values({
        unitId: params.unitId,
        title: body.title,
        description: body.description,
        estimatedDurationMinutes: body.estimatedDurationMinutes,
        orderIndex: body.orderIndex ?? (latestLesson?.orderIndex ?? -1) + 1,
        plannedStartMeeting: body.plannedStartMeeting ?? null,
        plannedMeetingCount: body.plannedMeetingCount ?? null
      });

      const detail = await buildCourseDetail(user.id, courseId);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.patch(
    '/v1/lessons/:lessonId',
    {
      schema: {
        params: LessonParamsSchema,
        body: LessonUpdateRequestSchema,
        response: {
          200: CourseDetailResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = LessonParamsSchema.parse(request.params);
      const body = LessonUpdateRequestSchema.parse(request.body);

      const ownedCourseId = await findOwnedCourseIdForLesson(user.id, params.lessonId);
      if (!ownedCourseId) {
        (reply as any).code(404);
        return { error: 'Lesson not found', requestId: request.id };
      }

      const updates: Partial<typeof lessons.$inferInsert> = {
        updatedAt: new Date()
      };
      if (body.title !== undefined) updates.title = body.title;
      if (body.description !== undefined) updates.description = body.description;
      if (body.estimatedDurationMinutes !== undefined) {
        updates.estimatedDurationMinutes = body.estimatedDurationMinutes;
      }
      if (body.orderIndex !== undefined) updates.orderIndex = body.orderIndex;
      if (body.plannedStartMeeting !== undefined)
        updates.plannedStartMeeting = body.plannedStartMeeting;
      if (body.plannedMeetingCount !== undefined)
        updates.plannedMeetingCount = body.plannedMeetingCount;
      if (body.unitId !== undefined) {
        const destinationCourseId = await findOwnedCourseIdForUnit(user.id, body.unitId);
        if (destinationCourseId !== ownedCourseId) {
          (reply as any).code(400);
          return { error: 'Lessons can only move within the same course', requestId: request.id };
        }
        updates.unitId = body.unitId;
      }

      await db.update(lessons).set(updates).where(eq(lessons.id, params.lessonId));

      const detail = await buildCourseDetail(user.id, ownedCourseId);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.delete(
    '/v1/lessons/:lessonId',
    {
      schema: {
        params: LessonParamsSchema,
        response: {
          200: DeleteEntityResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = LessonParamsSchema.parse(request.params);

      const courseId = await findOwnedCourseIdForLesson(user.id, params.lessonId);
      if (!courseId) {
        (reply as any).code(404);
        return { error: 'Lesson not found', requestId: request.id };
      }

      await db.delete(lessons).where(eq(lessons.id, params.lessonId));
      return { deleted: true };
    }
  );

  app.post(
    '/v1/lessons/:lessonId/segments',
    {
      schema: {
        params: LessonParamsSchema,
        body: SegmentCreateRequestSchema,
        response: {
          200: CourseDetailResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = LessonParamsSchema.parse(request.params);
      const body = SegmentCreateRequestSchema.parse(request.body);

      const courseId = await findOwnedCourseIdForLesson(user.id, params.lessonId);
      if (!courseId) {
        (reply as any).code(404);
        return { error: 'Lesson not found', requestId: request.id };
      }

      const [latestSegment] = await db
        .select({ orderIndex: lessonSegments.orderIndex })
        .from(lessonSegments)
        .where(eq(lessonSegments.lessonId, params.lessonId))
        .orderBy(desc(lessonSegments.orderIndex))
        .limit(1);

      await db.insert(lessonSegments).values({
        lessonId: params.lessonId,
        title: body.title,
        description: body.description,
        durationMinutes: body.durationMinutes,
        orderIndex: body.orderIndex ?? (latestSegment?.orderIndex ?? -1) + 1
      });

      const detail = await buildCourseDetail(user.id, courseId);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.patch(
    '/v1/segments/:segmentId',
    {
      schema: {
        params: SegmentParamsSchema,
        body: SegmentUpdateRequestSchema,
        response: {
          200: CourseDetailResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = SegmentParamsSchema.parse(request.params);
      const body = SegmentUpdateRequestSchema.parse(request.body);

      const ownedCourseId = await findOwnedCourseIdForSegment(user.id, params.segmentId);
      if (!ownedCourseId) {
        (reply as any).code(404);
        return { error: 'Segment not found', requestId: request.id };
      }

      const updates: Partial<typeof lessonSegments.$inferInsert> = {};
      if (body.title !== undefined) updates.title = body.title;
      if (body.description !== undefined) updates.description = body.description;
      if (body.durationMinutes !== undefined) updates.durationMinutes = body.durationMinutes;
      if (body.orderIndex !== undefined) updates.orderIndex = body.orderIndex;

      if (Object.keys(updates).length > 0) {
        await db.update(lessonSegments).set(updates).where(eq(lessonSegments.id, params.segmentId));
      }

      const detail = await buildCourseDetail(user.id, ownedCourseId);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.delete(
    '/v1/segments/:segmentId',
    {
      schema: {
        params: SegmentParamsSchema,
        response: {
          200: DeleteEntityResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = SegmentParamsSchema.parse(request.params);

      const courseId = await findOwnedCourseIdForSegment(user.id, params.segmentId);
      if (!courseId) {
        (reply as any).code(404);
        return { error: 'Segment not found', requestId: request.id };
      }

      await db.delete(lessonSegments).where(eq(lessonSegments.id, params.segmentId));
      return { deleted: true };
    }
  );

  app.post(
    '/v1/schedule/import',
    {
      schema: {
        body: ScheduleImportRequestSchema,
        response: {
          200: ScheduleImportResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const body = ScheduleImportRequestSchema.parse(request.body);

      if (!hasScheduleImportInput(body)) {
        (reply as any).code(400);
        return {
          error: 'Paste schedule text or upload a schedule image/PDF',
          requestId: request.id
        };
      }

      if (!app.config.OPENAI_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENAI_API_KEY is not configured', requestId: request.id };
      }

      const response = await runStructuredPrompt<z.infer<typeof InternalParseScheduleSchema>>({
        apiKey: app.config.OPENAI_API_KEY,
        model: app.config.OPENAI_MODEL_PARSE_SCHEDULE,
        reasoningEffort: app.config.OPENAI_REASONING_EFFORT_PARSE_SCHEDULE,
        schemaName: 'schedule_import',
        schema: InternalParseScheduleSchema,
        systemPrompt: [
          'Extract schedule classes and assignments. Return JSON only. Ignore non-teaching blocks like lunch/planning.',
          'Each class object represents one meeting occurrence. Its `name` is the shared course curriculum; its `period` is the separate class-group label, never the bell-period/grid row.',
          'When class names differ only by a trailing section letter, group label, or period suffix, treat them as one course curriculum.',
          'For example, Spanish 5A, Spanish 5B, and Spanish 5C must use `name: "Spanish 5"` with separate `period` values such as "Group A", "Group B", and "Group C".',
          'If Spanish 5B meets Monday at 08:10 and Thursday at 13:35, return two records with `name: "Spanish 5"` and `period: "Group B"`; give each record its own day and time. Do not append "Period 1" or another bell period to the group label.',
          'For a grid image, make a complete row-and-column pass over every nonempty teaching cell. Translate shorthand like 7B into `name: "Spanish 7"`, `period: "Group B"`, and capture text in parentheses as the room/location. Before returning, verify that every visible class-group label has a record.',
          'Do not create separate courses merely because A, B, C or a bell-period label differs.'
        ].join(' '),
        userPrompt: scheduleImportUserPrompt(body),
        fileDataUrl: scheduleImportFileDataUrl(body),
        fileName: body.fileName
      });

      // A second visual pass prevents a common grid-reading mistake: combining
      // a class group's different weekday time slots into a single meeting.
      const auditedResponse = await runStructuredPrompt<
        z.infer<typeof InternalParseScheduleSchema>
      >({
        apiKey: app.config.OPENAI_API_KEY,
        model: app.config.OPENAI_MODEL_PARSE_SCHEDULE,
        reasoningEffort: app.config.OPENAI_REASONING_EFFORT_PARSE_SCHEDULE,
        schemaName: 'schedule_import_audit',
        schema: InternalParseScheduleSchema,
        systemPrompt: [
          'You are the verification pass for a teacher schedule extracted from a visual grid. Return JSON only.',
          'A record represents one meeting occurrence: `name` is the shared course and `period` is its class-group label, never a bell-period/grid row.',
          'Audit every nonempty teaching cell. Keep groups with the same time on multiple days together, but emit separate records when their times differ.',
          'Use normalized names such as `Spanish 5` with `Group A`, `Group B`, and `Group C`.'
        ].join(' '),
        userPrompt: scheduleImportAuditPrompt(body, response),
        fileDataUrl: scheduleImportFileDataUrl(body),
        fileName: body.fileName
      });

      return ParseScheduleResponseSchema.parse(auditedResponse);
    }
  );

  app.post(
    '/v1/schedule/import/correct',
    {
      schema: {
        body: ScheduleImportCorrectionRequestSchema,
        response: {
          200: ScheduleImportResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const body = ScheduleImportCorrectionRequestSchema.parse(request.body);

      if (!app.config.OPENAI_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENAI_API_KEY is not configured', requestId: request.id };
      }

      const response = await runStructuredPrompt<z.infer<typeof InternalParseScheduleSchema>>({
        apiKey: app.config.OPENAI_API_KEY,
        model: app.config.OPENAI_MODEL_PARSE_SCHEDULE,
        reasoningEffort: app.config.OPENAI_REASONING_EFFORT_PARSE_SCHEDULE,
        schemaName: 'schedule_import_correction',
        schema: InternalParseScheduleSchema,
        systemPrompt:
          'You correct a parsed teacher schedule. Preserve all class groups and meeting details unless explicitly changed. For every changed record, return only its corrected version, never the original plus the correction. Return the complete corrected JSON only.',
        userPrompt: scheduleImportCorrectionPrompt(body)
      });

      return ParseScheduleResponseSchema.parse(response);
    }
  );

  app.post(
    '/v1/schedule/import/apply',
    {
      schema: {
        body: ScheduleImportApplyRequestSchema,
        response: {
          200: GetScheduleResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const schoolId = await loadTeacherSchoolId(user.id);
      const body = ScheduleImportApplyRequestSchema.parse(request.body);

      const classGroups = Array.from(
        body.classes
          .reduce((groups, parsedClass) => {
            const key = `${importNameKey(parsedClass.name)}|${importNameKey(parsedClass.period)}`;
            const group = groups.get(key) ?? { classes: [] as typeof body.classes };
            group.classes.push(parsedClass);
            groups.set(key, group);
            return groups;
          }, new Map<string, { classes: typeof body.classes }>())
          .values()
      );

      await db.transaction(async (tx) => {
        const existingCourses = await tx
          .select({ id: courses.id, name: courses.name })
          .from(courses)
          .where(eq(courses.teacherId, user.id));
        const coursesByName = new Map(
          existingCourses.map((course) => [importNameKey(course.name), course.id])
        );
        const existingSections = await tx
          .select({ courseId: sections.courseId, sectionName: sections.name })
          .from(sections)
          .innerJoin(courses, eq(sections.courseId, courses.id))
          .where(eq(courses.teacherId, user.id));
        const sectionKeys = new Set(
          existingSections.map(
            (section) => `${section.courseId}|${importNameKey(section.sectionName)}`
          )
        );

        for (const classGroup of classGroups) {
          const firstClass = classGroup.classes[0];
          if (!firstClass) continue;
          const courseKey = importNameKey(firstClass.name);
          let courseId = coursesByName.get(courseKey);
          if (!courseId) {
            const [course] = await tx
              .insert(courses)
              .values({
                teacherId: user.id,
                schoolId,
                name: firstClass.name,
                subject: firstClass.subject || null,
                gradeLevel: firstClass.grade || null
              })
              .returning({ id: courses.id });
            if (!course) throw new Error('Failed to create course');
            courseId = course.id;
            coursesByName.set(courseKey, courseId);
          }

          const sectionKey = `${courseId}|${importNameKey(firstClass.period)}`;
          if (sectionKeys.has(sectionKey)) continue;
          const [section] = await tx
            .insert(sections)
            .values({ courseId, name: firstClass.period })
            .returning({ id: sections.id });
          if (!section) throw new Error('Failed to create class group');

          const meetings = classGroup.classes
            .flatMap((parsedClass) =>
              parsedClass.days.map((day) => ({
                day,
                time: parsedClass.time,
                endTime: parsedClass.endTime ?? endTimeFromStart(parsedClass.time),
                room: parsedClass.room
              }))
            )
            .filter(
              (meeting, index, allMeetings) =>
                allMeetings.findIndex(
                  (candidate) =>
                    candidate.day === meeting.day &&
                    candidate.time === meeting.time &&
                    candidate.endTime === meeting.endTime &&
                    candidate.room === meeting.room
                ) === index
            );
          if (meetings.length) {
            await tx.insert(sectionMeetings).values(
              meetings.map((meeting) => ({
                sectionId: section.id,
                day: meeting.day,
                meetingTime: meeting.time,
                endTime: meeting.endTime,
                room: meeting.room
              }))
            );
          }
          sectionKeys.add(sectionKey);
        }
      });

      return buildScheduleResponse(user.id, schoolId);
    }
  );

  app.post(
    '/v1/holidays',
    {
      schema: {
        body: HolidaysUpsertRequestSchema,
        response: {
          200: HolidaysUpsertResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const schoolId = await loadTeacherSchoolId(user.id);
      const body = HolidaysUpsertRequestSchema.parse(request.body);

      if (!body.holidays.length) return { count: 0 };

      await db
        .insert(schoolHolidays)
        .values(
          body.holidays.map((holiday) => ({
            schoolId,
            date: holiday.date,
            name: holiday.name,
            createdByUserId: user.id
          }))
        )
        .onConflictDoNothing({
          target: [schoolHolidays.schoolId, schoolHolidays.date]
        });

      return { count: body.holidays.length };
    }
  );

  app.delete(
    '/v1/holidays/:holidayId',
    {
      schema: {
        params: HolidayParamsSchema,
        response: {
          200: DeleteEntityResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const schoolId = await loadTeacherSchoolId(user.id);
      const params = HolidayParamsSchema.parse(request.params);

      const [deleted] = await db
        .delete(schoolHolidays)
        .where(and(eq(schoolHolidays.id, params.holidayId), eq(schoolHolidays.schoolId, schoolId)))
        .returning({ id: schoolHolidays.id });

      if (!deleted) {
        (reply as any).code(404);
        return { error: 'No-school day not found', requestId: request.id };
      }

      return { deleted: true };
    }
  );

  app.post(
    '/v1/feedback',
    {
      schema: {
        body: FeedbackSubmitRequestSchema,
        response: {
          200: FeedbackSubmitResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const body = FeedbackSubmitRequestSchema.parse(request.body);

      const [event] = await db
        .insert(auditEvents)
        .values({
          userId: user.id,
          eventType: 'teacher_feedback_submitted',
          entityType: 'feedback',
          entityId: randomUUID(),
          metadata: {
            type: body.type,
            page: body.page,
            message: body.message,
            userAgent: body.userAgent ?? null,
            email: user.email
          }
        })
        .returning({ id: auditEvents.id });

      if (!event) {
        throw new Error('Feedback could not be saved');
      }

      return FeedbackSubmitResponseSchema.parse({ feedbackId: event.id, saved: true });
    }
  );

  app.post(
    '/v1/lesson-progress/upsert',
    {
      schema: {
        body: LessonProgressUpsertRequestSchema,
        response: {
          200: LessonProgressUpsertResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const body = LessonProgressUpsertRequestSchema.parse(request.body);

      const ownedLesson = await findOwnedLessonInSectionCourse(
        user.id,
        body.sectionId,
        body.lessonId
      );
      if (!ownedLesson) {
        (reply as any).code(404);
        return { error: 'Section or lesson not found', requestId: request.id };
      }

      const [state] = await db
        .insert(sectionLessonState)
        .values({
          sectionId: body.sectionId,
          lessonId: body.lessonId,
          status: body.status,
          currentSegmentId: body.currentSegmentId,
          stoppedAtSegmentId: body.stoppedAtSegmentId,
          completedSegmentIds: body.completedSegmentIds,
          carryOverNote: body.carryOverNote,
          lastTaughtDate: body.lastTaughtDate
        })
        .onConflictDoUpdate({
          target: [sectionLessonState.sectionId, sectionLessonState.lessonId],
          set: {
            status: body.status,
            currentSegmentId: body.currentSegmentId,
            stoppedAtSegmentId: body.stoppedAtSegmentId,
            completedSegmentIds: body.completedSegmentIds,
            carryOverNote: body.carryOverNote,
            lastTaughtDate: body.lastTaughtDate,
            updatedAt: new Date()
          }
        })
        .returning({
          id: sectionLessonState.id,
          updatedAt: sectionLessonState.updatedAt
        });
      if (!state) throw new Error('Failed to upsert lesson state');

      return {
        stateId: state.id,
        updatedAt: state.updatedAt.toISOString()
      };
    }
  );

  app.post(
    '/v1/class-notes/upsert',
    {
      schema: {
        body: ClassNotesUpsertRequestSchema,
        response: {
          200: ClassNotesUpsertResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const body = ClassNotesUpsertRequestSchema.parse(request.body);

      const ownedSection = await findOwnedSection(user.id, body.sectionId);
      if (!ownedSection) {
        (reply as any).code(404);
        return { error: 'Section not found', requestId: request.id };
      }

      const [note] = await db
        .insert(classNotes)
        .values({
          sectionId: body.sectionId,
          userId: user.id,
          date: body.date,
          noteType: body.noteType,
          content: body.content
        })
        .onConflictDoUpdate({
          target: [classNotes.sectionId, classNotes.userId, classNotes.date, classNotes.noteType],
          set: {
            content: body.content,
            updatedAt: new Date()
          }
        })
        .returning({
          id: classNotes.id,
          updatedAt: classNotes.updatedAt
        });
      if (!note) throw new Error('Failed to upsert class note');

      return {
        noteId: note.id,
        updatedAt: note.updatedAt.toISOString()
      };
    }
  );

  app.post(
    '/v1/files/sign-upload',
    {
      schema: {
        body: CreateUploadUrlRequestSchema,
        response: {
          200: CreateUploadUrlResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      await ensureUserFromPrincipal(principal);

      const body = CreateUploadUrlRequestSchema.parse(request.body);
      const s3Client = createS3Client(app.config);
      const objectKey = `materials/${randomUUID()}-${body.fileName}`;

      const uploadUrl = await createSignedUploadUrl({
        client: s3Client,
        bucket: app.config.S3_BUCKET,
        objectKey,
        contentType: body.contentType
      });

      if (!uploadUrl) {
        (reply as any).code(503);
        return { error: 'S3 is not configured', requestId: request.id };
      }

      return { objectKey, uploadUrl };
    }
  );

  app.post(
    '/v1/ai/parse-schedule/queue',
    {
      schema: {
        body: ScheduleImportRequestSchema,
        response: {
          200: AiJobEnqueueResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      const body = ScheduleImportRequestSchema.parse(request.body);
      if (!hasScheduleImportInput(body)) {
        (reply as any).code(400);
        return {
          error: 'Paste schedule text or upload a schedule image/PDF',
          requestId: request.id
        };
      }

      if (!app.aiQueue) {
        (reply as any).code(503);
        return { error: 'AI queue is unavailable. Configure REDIS_URL.', requestId: request.id };
      }

      const user = await ensureUserFromPrincipal(principal);
      const [job] = await db
        .insert(aiJobs)
        .values({
          userId: user.id,
          type: 'parse_schedule',
          status: 'queued',
          input: body
        })
        .returning({ id: aiJobs.id, status: aiJobs.status });
      if (!job) throw new Error('Failed to create AI job');

      await enqueueAiJob(app.aiQueue, job.id);
      return {
        jobId: job.id,
        status: job.status
      };
    }
  );

  app.post(
    '/v1/ai/generate-segments/queue',
    {
      schema: {
        body: GenerateSegmentsRequestSchema,
        response: {
          200: AiJobEnqueueResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      const body = GenerateSegmentsRequestSchema.parse(request.body);

      if (!app.aiQueue) {
        (reply as any).code(503);
        return { error: 'AI queue is unavailable. Configure REDIS_URL.', requestId: request.id };
      }

      const user = await ensureUserFromPrincipal(principal);
      const [job] = await db
        .insert(aiJobs)
        .values({
          userId: user.id,
          type: 'generate_segments',
          status: 'queued',
          input: body
        })
        .returning({ id: aiJobs.id, status: aiJobs.status });
      if (!job) throw new Error('Failed to create AI job');

      await enqueueAiJob(app.aiQueue, job.id);
      return {
        jobId: job.id,
        status: job.status
      };
    }
  );

  app.post(
    '/v1/ai/generate-continuity/queue',
    {
      schema: {
        body: GenerateContinuityRequestSchema,
        response: {
          200: AiJobEnqueueResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      const body = GenerateContinuityRequestSchema.parse(request.body);

      if (!app.aiQueue) {
        (reply as any).code(503);
        return { error: 'AI queue is unavailable. Configure REDIS_URL.', requestId: request.id };
      }

      const user = await ensureUserFromPrincipal(principal);
      const [job] = await db
        .insert(aiJobs)
        .values({
          userId: user.id,
          type: 'generate_continuity',
          status: 'queued',
          input: body
        })
        .returning({ id: aiJobs.id, status: aiJobs.status });
      if (!job) throw new Error('Failed to create AI job');

      await enqueueAiJob(app.aiQueue, job.id);
      return {
        jobId: job.id,
        status: job.status
      };
    }
  );

  app.get(
    '/v1/ai/jobs/:jobId',
    {
      schema: {
        params: z.object({ jobId: UuidSchema }),
        response: {
          200: AiJobStatusResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = AiJobParamsSchema.parse(request.params);

      const [job] = await db
        .select({
          id: aiJobs.id,
          type: aiJobs.type,
          status: aiJobs.status,
          output: aiJobs.output,
          error: aiJobs.error,
          cancelRequested: aiJobs.cancelRequested
        })
        .from(aiJobs)
        .where(and(eq(aiJobs.id, params.jobId), eq(aiJobs.userId, user.id)))
        .limit(1);

      if (!job) {
        (reply as any).code(404);
        return { error: 'AI job not found', requestId: request.id };
      }

      let attemptsMade = 0;
      let maxAttempts = AI_JOB_MAX_ATTEMPTS;
      let progressPercent: number | null = null;

      if (app.aiQueue) {
        const queueJob = await app.aiQueue.getJob(job.id);
        if (queueJob) {
          attemptsMade = queueJob.attemptsMade;
          maxAttempts = queueJob.opts.attempts ?? AI_JOB_MAX_ATTEMPTS;
          progressPercent = normalizeProgressPercent(queueJob.progress);
        }
      }

      if (progressPercent === null) {
        if (job.status === 'queued') progressPercent = 5;
        else if (job.status === 'running') progressPercent = 45;
        else progressPercent = 100;
      }

      if (job.status === 'failed' && attemptsMade === 0) {
        attemptsMade = maxAttempts;
      }

      const canCancel = job.status === 'queued' || job.status === 'running';
      const canRetry = job.status === 'failed' || job.status === 'cancelled';

      return {
        jobId: job.id,
        type: job.type as 'parse_schedule' | 'generate_segments' | 'generate_continuity',
        status: job.status,
        output: job.output ?? null,
        error: job.error,
        cancelRequested: job.cancelRequested,
        attemptsMade,
        maxAttempts,
        progressPercent,
        canCancel,
        canRetry
      };
    }
  );

  app.post(
    '/v1/ai/jobs/:jobId/cancel',
    {
      schema: {
        params: AiJobParamsSchema,
        response: {
          200: AiJobControlResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = AiJobParamsSchema.parse(request.params);

      const [job] = await db
        .select({
          id: aiJobs.id,
          status: aiJobs.status
        })
        .from(aiJobs)
        .where(and(eq(aiJobs.id, params.jobId), eq(aiJobs.userId, user.id)))
        .limit(1);

      if (!job) {
        (reply as any).code(404);
        return { error: 'AI job not found', requestId: request.id };
      }

      if (job.status === 'queued') {
        await db
          .update(aiJobs)
          .set({
            status: 'cancelled',
            cancelRequested: true,
            error: 'Cancelled by user',
            updatedAt: new Date()
          })
          .where(eq(aiJobs.id, params.jobId));

        if (app.aiQueue) {
          await app.aiQueue.remove(params.jobId).catch(() => undefined);
        }

        return { jobId: params.jobId, status: 'cancelled', action: 'cancelled' };
      }

      if (job.status === 'running') {
        await db
          .update(aiJobs)
          .set({
            cancelRequested: true,
            updatedAt: new Date()
          })
          .where(eq(aiJobs.id, params.jobId));

        return { jobId: params.jobId, status: 'running', action: 'cancelled' };
      }

      return { jobId: params.jobId, status: job.status, action: 'cancelled' };
    }
  );

  app.post(
    '/v1/ai/jobs/:jobId/retry',
    {
      schema: {
        params: AiJobParamsSchema,
        response: {
          200: AiJobControlResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = AiJobParamsSchema.parse(request.params);

      if (!app.aiQueue) {
        (reply as any).code(503);
        return { error: 'AI queue is unavailable. Configure REDIS_URL.', requestId: request.id };
      }

      const [job] = await db
        .select({
          id: aiJobs.id,
          status: aiJobs.status
        })
        .from(aiJobs)
        .where(and(eq(aiJobs.id, params.jobId), eq(aiJobs.userId, user.id)))
        .limit(1);

      if (!job) {
        (reply as any).code(404);
        return { error: 'AI job not found', requestId: request.id };
      }

      if (job.status !== 'failed' && job.status !== 'cancelled') {
        (reply as any).code(409);
        return {
          error: 'Only failed or cancelled jobs can be retried',
          requestId: request.id
        };
      }

      await db
        .update(aiJobs)
        .set({
          status: 'queued',
          output: null,
          error: null,
          cancelRequested: false,
          updatedAt: new Date()
        })
        .where(eq(aiJobs.id, params.jobId));

      await enqueueAiJob(app.aiQueue, params.jobId);

      return { jobId: params.jobId, status: 'queued', action: 'requeued' };
    }
  );

  app.post(
    '/v1/ai/parse-schedule',
    {
      schema: {
        body: ScheduleImportRequestSchema,
        response: {
          200: ParseScheduleResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      const body = ScheduleImportRequestSchema.parse(request.body);
      if (!hasScheduleImportInput(body)) {
        (reply as any).code(400);
        return {
          error: 'Paste schedule text or upload a schedule image/PDF',
          requestId: request.id
        };
      }

      if (!app.config.OPENAI_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENAI_API_KEY is not configured', requestId: request.id };
      }

      const user = await ensureUserFromPrincipal(principal);
      const [job] = await db
        .insert(aiJobs)
        .values({
          userId: user.id,
          type: 'parse_schedule',
          status: 'running',
          input: body
        })
        .returning({ id: aiJobs.id });
      if (!job) throw new Error('Failed to create AI job');

      try {
        const output = await runStructuredPrompt<z.infer<typeof InternalParseScheduleSchema>>({
          apiKey: app.config.OPENAI_API_KEY,
          model: app.config.OPENAI_MODEL_PARSE_SCHEDULE,
          reasoningEffort: app.config.OPENAI_REASONING_EFFORT_PARSE_SCHEDULE,
          schemaName: 'parse_schedule',
          schema: InternalParseScheduleSchema,
          systemPrompt:
            'Extract classes and assignments from teacher schedule text. Return JSON only and skip non-teaching events.',
          userPrompt: scheduleImportUserPrompt(body),
          fileDataUrl: scheduleImportFileDataUrl(body),
          fileName: body.fileName
        });

        await db.insert(aiOutputs).values({
          jobId: job.id,
          outputType: 'parse_schedule',
          payload: output
        });
        await db
          .update(aiJobs)
          .set({ status: 'succeeded', output, updatedAt: new Date() })
          .where(eq(aiJobs.id, job.id));

        return ParseScheduleResponseSchema.parse(output);
      } catch (error) {
        await db
          .update(aiJobs)
          .set({
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            updatedAt: new Date()
          })
          .where(eq(aiJobs.id, job.id));
        throw error;
      }
    }
  );

  app.post(
    '/v1/ai/generate-unit-draft',
    {
      schema: {
        body: GenerateUnitDraftRequestSchema,
        response: {
          200: GenerateUnitDraftResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      if (!app.config.OPENAI_API_KEY) {
        (reply as any).code(503);
        return { error: 'Planning service is not configured', requestId: request.id };
      }

      const body = GenerateUnitDraftRequestSchema.parse(request.body);
      const user = await ensureUserFromPrincipal(principal);
      const [job] = await db
        .insert(aiJobs)
        .values({ userId: user.id, type: 'generate_unit_draft', status: 'running', input: body })
        .returning({ id: aiJobs.id });
      if (!job) throw new Error('Failed to create planning draft');

      try {
        const output = await runStructuredPrompt<z.infer<typeof GenerateUnitDraftResponseSchema>>({
          apiKey: app.config.OPENAI_API_KEY,
          model: app.config.OPENAI_MODEL_GENERATE_SEGMENTS,
          schemaName: 'generate_unit_draft',
          schema: GenerateUnitDraftResponseSchema,
          systemPrompt:
            'Create one concise, classroom-ready curriculum unit. Return a practical sequence of lessons. This is a draft for a teacher to review, never an instruction to alter stored curriculum.',
          userPrompt: `Course: ${body.courseName}\nGrade: ${body.gradeLevel ?? 'Not specified'}\nInstructional meetings: ${body.meetingCount}\nTeacher request: ${body.prompt}`
        });
        await db
          .insert(aiOutputs)
          .values({ jobId: job.id, outputType: 'generate_unit_draft', payload: output });
        await db
          .update(aiJobs)
          .set({ status: 'succeeded', output, updatedAt: new Date() })
          .where(eq(aiJobs.id, job.id));
        return output;
      } catch (error) {
        await db
          .update(aiJobs)
          .set({
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            updatedAt: new Date()
          })
          .where(eq(aiJobs.id, job.id));
        throw error;
      }
    }
  );

  app.post(
    '/v1/ai/generate-segments',
    {
      schema: {
        body: GenerateSegmentsRequestSchema,
        response: {
          200: GenerateSegmentsResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      if (!app.config.OPENAI_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENAI_API_KEY is not configured', requestId: request.id };
      }

      const body = GenerateSegmentsRequestSchema.parse(request.body);
      const user = await ensureUserFromPrincipal(principal);

      const [job] = await db
        .insert(aiJobs)
        .values({
          userId: user.id,
          type: 'generate_segments',
          status: 'running',
          input: body
        })
        .returning({ id: aiJobs.id });
      if (!job) throw new Error('Failed to create AI job');

      try {
        const output = await runStructuredPrompt<z.infer<typeof GenerateSegmentsResponseSchema>>({
          apiKey: app.config.OPENAI_API_KEY,
          model: app.config.OPENAI_MODEL_GENERATE_SEGMENTS,
          schemaName: 'generate_segments',
          schema: GenerateSegmentsResponseSchema,
          systemPrompt:
            'Generate practical, classroom-ready lesson segments with realistic durations and concise descriptions.',
          userPrompt: `Lesson title: ${body.lessonTitle}\nObjective: ${body.objective ?? 'None'}\nTotal minutes: ${body.durationMinutes}`
        });

        await db.insert(aiOutputs).values({
          jobId: job.id,
          outputType: 'generate_segments',
          payload: output
        });
        await db
          .update(aiJobs)
          .set({ status: 'succeeded', output, updatedAt: new Date() })
          .where(eq(aiJobs.id, job.id));
        return output;
      } catch (error) {
        await db
          .update(aiJobs)
          .set({
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            updatedAt: new Date()
          })
          .where(eq(aiJobs.id, job.id));
        throw error;
      }
    }
  );

  app.post(
    '/v1/ai/generate-continuity',
    {
      schema: {
        body: GenerateContinuityRequestSchema,
        response: {
          200: GenerateContinuityResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      if (!app.config.OPENAI_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENAI_API_KEY is not configured', requestId: request.id };
      }

      const body = GenerateContinuityRequestSchema.parse(request.body);
      const user = await ensureUserFromPrincipal(principal);

      const [job] = await db
        .insert(aiJobs)
        .values({
          userId: user.id,
          type: 'generate_continuity',
          status: 'running',
          input: body
        })
        .returning({ id: aiJobs.id });
      if (!job) throw new Error('Failed to create AI job');

      try {
        const output = await runStructuredPrompt<z.infer<typeof GenerateContinuityResponseSchema>>({
          apiKey: app.config.OPENAI_API_KEY,
          model: app.config.OPENAI_MODEL_CONTINUITY,
          schemaName: 'generate_continuity',
          schema: GenerateContinuityResponseSchema,
          systemPrompt:
            'You are helping a teacher continue the next class smoothly. Keep output concise and practical.',
          userPrompt: `Lesson: ${body.lessonTitle}\nLast segment: ${body.lastSegmentTitle ?? 'Unknown'}\nLast note: ${body.lastNote ?? 'None'}\nPrevious summary: ${body.previousLessonSummary ?? 'None'}`
        });

        await db.insert(aiOutputs).values({
          jobId: job.id,
          outputType: 'generate_continuity',
          payload: output
        });
        await db
          .update(aiJobs)
          .set({ status: 'succeeded', output, updatedAt: new Date() })
          .where(eq(aiJobs.id, job.id));
        return output;
      } catch (error) {
        await db
          .update(aiJobs)
          .set({
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            updatedAt: new Date()
          })
          .where(eq(aiJobs.id, job.id));
        throw error;
      }
    }
  );
}
