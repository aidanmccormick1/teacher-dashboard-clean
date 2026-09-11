import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, gt, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  AiJobControlResponseSchema,
  AiJobEnqueueResponseSchema,
  AiJobStatusResponseSchema,
  AccountResetRequestSchema,
  AccountResetResponseSchema,
  CalendarCommitRequestSchema,
  CalendarCommitResponseSchema,
  CalendarImportExtractionSchema,
  CalendarImportRequestSchema,
  CalendarImportResponseSchema,
  ClassroomResumeResponseSchema,
  ClassNotesUpsertRequestSchema,
  ClassNotesUpsertResponseSchema,
  ClassMeetingUpsertRequestSchema,
  ClassMeetingLookupQuerySchema,
  ClassMeetingLookupResponseSchema,
  ClassMeetingResponseSchema,
  CreateUploadUrlRequestSchema,
  CreateUploadUrlResponseSchema,
  CourseCreateRequestSchema,
  CourseCurriculumCopyRequestSchema,
  CourseCollaboratorInviteRequestSchema,
  CourseCollaboratorsResponseSchema,
  CourseActivityResponseSchema,
  CourseInvitationAcceptRequestSchema,
  CourseDeleteRequestSchema,
  CourseOwnershipTransferRequestSchema,
  CoursePacingResponseSchema,
  CoursePacingSharingUpdateRequestSchema,
  CourseDuplicateRequestSchema,
  CourseDetailResponseSchema,
  CourseListResponseSchema,
  CourseInvitationsResponseSchema,
  CourseShareResponseSchema,
  CourseShareUpdateRequestSchema,
  CourseOrderUpdateRequestSchema,
  CourseUpdateRequestSchema,
  CurriculumRangeCreateRequestSchema,
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
  SegmentReorderRequestSchema,
  SegmentUpdateRequestSchema,
  ScheduleImportRequestSchema,
  ScheduleImportCorrectionRequestSchema,
  ScheduleImportApplyRequestSchema,
  ScheduleImportResponseSchema,
  SectionMutationRequestSchema,
  SectionUpdateRequestSchema,
  UnitCreateRequestSchema,
  UnitUpdateRequestSchema,
  UnitSlidesProgressResponseSchema,
  UnitSlidesProgressUpsertRequestSchema,
  LessonSlidesProgressResponseSchema,
  LessonSlidesProgressUpsertRequestSchema,
  LessonCreateRequestSchema,
  LessonUpdateRequestSchema,
  LessonShareResponseSchema,
  LessonShareUpdateRequestSchema,
  LessonWorkspaceResponseSchema,
  LessonCommentCreateRequestSchema,
  LessonCommentsResponseSchema,
  LocalAdminTestRoleRequestSchema,
  LocalAdminTestRoleResponseSchema,
  PublicLessonResponseSchema,
  PublicCurriculumResponseSchema,
  PublicCurriculumImportRequestSchema,
  MeetingInstancesQuerySchema,
  MeetingInstancesResponseSchema,
  NotificationListResponseSchema,
  SchoolCalendarResponseSchema,
  SchoolJoinRequestSchema,
  SchoolOverviewResponseSchema,
  SchoolSearchResponseSchema,
  SchoolInvitationAcceptResponseSchema,
  SchoolTimezoneUpdateRequestSchema,
  SchoolYearUpsertRequestSchema,
  SectionMeetingOverrideRequestSchema,
  SectionLessonPlanResponseSchema,
  SectionLessonPlanShiftRequestSchema,
  SectionPlanningContextQuerySchema,
  SectionPlanningContextResponseSchema,
  TeacherPreferencesSchema,
  TeacherPreferencesUpdateRequestSchema,
  UuidSchema
} from '@teacheros/contracts';
import {
  aiJobs,
  aiOutputs,
  auditEvents,
  classNotes,
  classMeetings,
  courseActivity,
  courses,
  courseCollaborators,
  courseShares,
  db,
  lessonSegments,
  lessonComments,
  lessonShares,
  lessons,
  notifications,
  schoolCalendarEvents,
  schoolHolidays,
  schoolClaimRequests,
  schoolInvitations,
  schoolYears,
  schoolMemberships,
  sectionMeetingOverrides,
  sectionLessonPlans,
  sectionPlanOperations,
  sectionLessonState,
  sectionLessonSlideState,
  sectionUnitSlideState,
  sectionMeetings,
  sections,
  schools,
  teacherProfiles,
  teacherCourses,
  teacherPreferences,
  units,
  users
} from '@teacheros/db';

import { runStructuredPrompt } from '../lib/openai.js';
import { safeRedisGet, safeRedisSet } from '../lib/redis.js';
import { createS3Client, createSignedUploadUrl } from '../lib/s3.js';
import { AI_JOB_MAX_ATTEMPTS, enqueueAiJob } from '../lib/queue.js';
import { ensureUserFromPrincipal, upsertOnboarding } from '../services/user-service.js';
import { canManageSchoolCalendar } from '../services/permissions.js';
import { buildMeetingInstances, loadActiveSchoolYear } from '../services/meeting-instances.js';
import {
  localDateFor,
  resolveTodayMeetings,
  validTimeZone
} from '../services/schedule-resolution.js';

// The model-facing schema must match the public import contract. A narrower
// schema previously omitted `endTime`, so Structured Outputs discarded every
// end time even when the vision model read it correctly.
const InternalParseScheduleSchema = ParseScheduleResponseSchema;

const InternalCalendarImportSchema = CalendarImportExtractionSchema;

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
    'You are not extracting every event from an academic calendar. You are identifying the instructional school year and events that affect normal student instruction.',
    'First determine the actual instructional school-year boundaries. Find the first instructional day for students and the last instructional day for students. Prioritize explicit wording such as First Day of School, First Day for Students, Students Begin, Classes Begin, School Begins, Last Day of School, Last Day for Students, Classes End, and Final Instructional Day.',
    'Do not use graduation, teacher checkout, teacher work after students finish, or administrative dates as the final day unless the source explicitly says students attend.',
    'Return those boundaries as `schoolYear`, with ISO dates, confidence, and compact source excerpts. Return events only inside those boundaries.',
    'Return one logical event per date range; never expand a break into daily rows. Only return events inside the instructional-year boundaries that cancel student instruction or alter the normal student schedule.',
    'Use no_school only when students do not attend. Use minimum_day, half_day, early_release, late_start, testing_schedule, special_schedule, or other_abnormal for altered school days. Do not invent bell times.',
    'Ignore ceremonies, extracurriculars, parent events, staff-only meetings, fundraisers, administrative deadlines, report cards, and informational events that do not affect regular student instruction. Teacher/staff days matter only when students do not attend or normal classes are affected.',
    'Use Classes Resume to understand a break boundary, but do not return it as an event. First and last instructional days are boundaries, never events.',
    'If a date such as Faculty Development Day may affect instruction but the document does not establish whether students attend, return it with needsReview true. Otherwise do not make the teacher review clear information.',
    'For each ignored event, return its title, date if known, and a concise reason (for example: After last instructional day; Does not affect normal instruction).',
    'For every returned event include title, startDate, endDate, type, affectsInstruction true, scheduleKnown, confidence, needsReview, and a compact source excerpt.',
    classGroups.length
      ? `If an alternate schedule explicitly identifies one of these Class Groups, emit a date-specific override for it: ${classGroups.join(', ')}.`
      : 'Do not emit an override unless the alternate schedule identifies a class group.',
    'Return JSON only.'
  ];
  return body.text ? [...instructions, '', body.text].join('\n') : instructions.join('\n');
}

function instructionalExceptionKey(event: {
  startDate: string;
  endDate: string;
  type: string;
  title: string;
}) {
  return `${event.startDate}|${event.endDate}|${event.type}|${importNameKey(event.title)}`;
}

function calendarTitlesMatch(left: string, right: string) {
  const words = (value: string) =>
    importNameKey(value)
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(' ')
      .filter((word) => word.length > 2 && !['school', 'classes', 'regular'].includes(word));
  const leftWords = words(left);
  const rightWords = words(right);
  return (
    importNameKey(left) === importNameKey(right) ||
    (leftWords.length > 0 &&
      rightWords.length > 0 &&
      leftWords.some((word) => rightWords.includes(word)))
  );
}

function expandInstructionalException(event: {
  startDate: string;
  endDate: string;
  type: string;
  title: string;
}) {
  const dates: string[] = [];
  const start = new Date(`${event.startDate}T12:00:00.000Z`);
  const end = new Date(`${event.endDate}T12:00:00.000Z`);
  for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    // Calendar ranges remain compact in the UI and we do not persist closures
    // for ordinary weekends that would never generate a class meeting.
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) dates.push(dateToIso(day));
  }
  return dates;
}

const scheduleImportSystemPrompt = [
  'Read a teacher schedule and return only the complete structured schedule. Ignore lunch, planning, breaks, homeroom, assemblies, Mass, and dismissal.',
  'A COURSE is the shared subject and level or grade, such as Spanish 5. A CLASS GROUP is the cohort taught within that course, such as Group B. The `name` field is the course. The `period` field is the class group.',
  'Course numbers belong to the course name. Spanish 5, Spanish 6, Spanish 7, and Spanish 8 are four different courses. Never return `name: "Spanish"` with `period: "5"`.',
  'Group markers belong in `period`. Spanish 5A, Spanish 5 B, Spanish 5 Group C, and Spanish 5, Group C all use `name: "Spanish 5"`; their `period` values are Group A, Group B, or Group C. Apply the same rule to Block, Section, Class, and cohort suffixes.',
  'A bell-period number or grid row identifies when a group meets, not which group it is. Do not use a bell-period label as `period` when the cell contains a real group marker.',
  'For pasted text, preserve its hierarchy. A course heading applies to the A/B/C or named group lines beneath it until the next course heading. Repeated course names that differ only by case, punctuation, word order, or a group suffix represent one course.',
  'Never turn a weekday, time range, room, bell-period row, note, or list heading into a course. Every returned course and class group must be supported by visible source text. Omit an unreadable item instead of inventing a plausible name.',
  'Build one record for each distinct course, class group, start time, end time, and room combination. Combine days in one record only when all those values match. If the same group meets at different times, return separate records with the exact same `name` and `period`.',
  'For a visual grid, first identify weekday columns and time-row boundaries. Then scan every nonempty teaching cell from top to bottom and left to right. A cell that spans rows starts at its top boundary and ends at its bottom boundary.',
  'Read both `time` and `endTime` from every visible range, row boundary, or start/end label. Use 24-hour HH:MM. Set `endTime` to null only when the source truly shows no ending boundary; never replace a visible end time with a guessed duration.',
  'Before returning, verify that every visible class group appears and that every non-null end time is later than its start time. Return assignments only when the source explicitly includes them.'
].join('\n');

function scheduleImportUserPrompt(body: ScheduleImportBody): string {
  const source =
    body.fileMimeType === 'application/pdf' || body.fileName?.toLowerCase().endsWith('.pdf')
      ? 'Analyze the attached PDF schedule.'
      : body.imageBase64 || body.fileBase64
        ? 'Analyze the attached schedule image.'
        : 'Analyze the pasted teacher schedule.';

  return body.text ? `${source}\n\nSource text:\n${body.text}` : source;
}

function scheduleImportCorrectionPrompt(body: ScheduleImportCorrectionBody): string {
  return [
    'Correct this already-parsed teacher schedule according to the teacher instruction.',
    'The `name` field is the complete shared course name, including its level or grade number. The `period` field is a distinct class-group label under that course, never a bell-period number.',
    'For example, Spanish 5 Group B and Spanish 5 Group C are one course named Spanish 5 with two class groups named Group B and Group C.',
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
    'Audit the attached visual schedule against the candidate extraction below. Return a complete corrected JSON schedule.',
    'Check the weekday headers, time-row boundaries, and every nonempty teaching cell. Keep a candidate only when the source supports it, remove invented records, add a group only when its label is visible, and correct any course, group, day, start time, end time, or room that conflicts with the source.',
    'A class-group label is never a bell-period row. Keep the same `name` and `period` for repeated meetings of one group. If Spanish 5B is Monday 08:10 to 09:05 and Thursday 13:35 to 14:30, return two records with `name: "Spanish 5"` and `period: "Group B"`.',
    'Use a visible time range or the top and bottom boundaries of a spanning cell for `time` and `endTime`. Use null only when the ending boundary is not visible. Do not infer a standard class duration.',
    'Use visible text in parentheses as the room when present. Ignore non-teaching blocks.',
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

function meetingOccurrenceKey(startTime: string | null | undefined): string {
  return startTime?.slice(0, 5) || 'legacy';
}

class MeetingRevisionConflictError extends Error {
  constructor(
    message = 'This class meeting changed in another session. Refresh to reconcile it.',
    readonly scheduledLesson: { id: string; title: string } | null = null
  ) {
    super(message);
    this.name = 'MeetingRevisionConflictError';
  }
}

class MeetingHistoryExistsError extends Error {
  constructor() {
    super(
      'This lesson already has class-meeting history. Save through the classroom meeting endpoint.'
    );
    this.name = 'MeetingHistoryExistsError';
  }
}

class SectionPlanUndoConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SectionPlanUndoConflictError';
  }
}

function endTimeFromStart(startTime: string | null): string | null {
  const startMinutes = timeToMinutes(startTime);
  if (startMinutes === null) return null;
  const endMinutes = (startMinutes + 55) % (24 * 60);
  return `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
}

async function loadTeacherSchoolId(userId: string): Promise<string> {
  const [profile] = await db
    .select({ schoolId: teacherProfiles.schoolId })
    .from(teacherProfiles)
    .innerJoin(
      schoolMemberships,
      and(
        eq(schoolMemberships.userId, teacherProfiles.userId),
        eq(schoolMemberships.schoolId, teacherProfiles.schoolId),
        eq(schoolMemberships.status, 'active')
      )
    )
    .where(eq(teacherProfiles.userId, userId))
    .limit(1);

  if (!profile) {
    const error = new Error(
      'Active school membership required. Complete onboarding first.'
    ) as Error & {
      statusCode?: number;
    };
    error.statusCode = 403;
    throw error;
  }
  return profile.schoolId;
}

async function loadSchoolTimezone(schoolId: string, request?: FastifyRequest): Promise<string> {
  const [school] = await db
    .select({ timezone: schools.timezone })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);
  const browserTimeZone = request?.headers['x-teacher-timezone'];
  return (
    validTimeZone(school?.timezone) ??
    validTimeZone(typeof browserTimeZone === 'string' ? browserTimeZone : null) ??
    'UTC'
  );
}

async function assertSchoolCalendarWriteAccess(
  userId: string,
  schoolId: string,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const [school] = await db
    .select({ claimStatus: schools.claimStatus })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);
  if (school?.claimStatus === 'claimed' && !(await canManageSchoolCalendar(userId, schoolId))) {
    reply.code(403).send({
      error: 'This school calendar is managed by an administrator.',
      requestId: request.id
    });
    return false;
  }
  return true;
}

async function buildSchoolCalendarResponse(
  schoolId: string,
  requestedSchoolYearId?: string,
  request?: FastifyRequest
) {
  const timezone = await loadSchoolTimezone(schoolId, request);
  const schoolYear = requestedSchoolYearId
    ? ((
        await db
          .select()
          .from(schoolYears)
          .where(and(eq(schoolYears.id, requestedSchoolYearId), eq(schoolYears.schoolId, schoolId)))
          .limit(1)
      )[0] ?? null)
    : await loadActiveSchoolYear(schoolId, timezone);
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
    isShared: true,
    timezone
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
const SectionUnitParamsSchema = z.object({ sectionId: UuidSchema, unitId: UuidSchema });
const SectionLessonParamsSchema = z.object({ sectionId: UuidSchema, lessonId: UuidSchema });
const HolidayParamsSchema = z.object({ holidayId: UuidSchema });
const AiJobParamsSchema = z.object({ jobId: UuidSchema });

function nextOrderIndex(items: Array<{ orderIndex: number }>) {
  return items.reduce((largest, item) => Math.max(largest, item.orderIndex), -1) + 1;
}

// Course membership determines curriculum access. Course ownership is only
// used for high-impact actions such as inviting collaborators or deleting the
// shared course; it never determines ownership of a class group.
async function findOwnedCourse(userId: string, courseId: string) {
  const [course] = await db
    .select({
      id: courses.id,
      schoolId: courses.schoolId,
      name: courses.name,
      subject: courses.subject,
      gradeLevel: courses.gradeLevel,
      sortIndex: courses.sortIndex,
      archivedAt: courseCollaborators.archivedAt,
      createdAt: courses.createdAt,
      updatedAt: courses.updatedAt,
      accessRole: courseCollaborators.role
    })
    .from(courses)
    .innerJoin(
      courseCollaborators,
      and(
        eq(courseCollaborators.courseId, courses.id),
        eq(courseCollaborators.userId, userId),
        eq(courseCollaborators.status, 'accepted')
      )
    )
    .innerJoin(
      schoolMemberships,
      and(
        eq(schoolMemberships.userId, userId),
        eq(schoolMemberships.schoolId, courses.schoolId),
        eq(schoolMemberships.status, 'active')
      )
    )
    .where(eq(courses.id, courseId))
    .limit(1);
  return course ?? null;
}

async function findCourseOwnedBy(userId: string, courseId: string) {
  const course = await findOwnedCourse(userId, courseId);
  return course?.accessRole === 'owner' ? course : null;
}

async function findOwnedCourseIdForUnit(userId: string, unitId: string) {
  const [row] = await db
    .select({
      courseId: units.courseId
    })
    .from(units)
    .innerJoin(courses, eq(units.courseId, courses.id))
    .innerJoin(
      courseCollaborators,
      and(
        eq(courseCollaborators.courseId, courses.id),
        eq(courseCollaborators.userId, userId),
        eq(courseCollaborators.status, 'accepted')
      )
    )
    .innerJoin(
      schoolMemberships,
      and(
        eq(schoolMemberships.userId, userId),
        eq(schoolMemberships.schoolId, courses.schoolId),
        eq(schoolMemberships.status, 'active')
      )
    )
    .where(eq(units.id, unitId))
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
    .innerJoin(
      courseCollaborators,
      and(
        eq(courseCollaborators.courseId, courses.id),
        eq(courseCollaborators.userId, userId),
        eq(courseCollaborators.status, 'accepted')
      )
    )
    .innerJoin(
      schoolMemberships,
      and(
        eq(schoolMemberships.userId, userId),
        eq(schoolMemberships.schoolId, courses.schoolId),
        eq(schoolMemberships.status, 'active')
      )
    )
    .where(eq(lessons.id, lessonId))
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
    .innerJoin(
      courseCollaborators,
      and(
        eq(courseCollaborators.courseId, courses.id),
        eq(courseCollaborators.userId, userId),
        eq(courseCollaborators.status, 'accepted')
      )
    )
    .innerJoin(
      schoolMemberships,
      and(
        eq(schoolMemberships.userId, userId),
        eq(schoolMemberships.schoolId, courses.schoolId),
        eq(schoolMemberships.status, 'active')
      )
    )
    .where(eq(lessonSegments.id, segmentId))
    .limit(1);

  return row?.courseId ?? null;
}

async function findOwnedSection(userId: string, sectionId: string) {
  const [row] = await db
    .select({
      sectionId: sections.id,
      sectionName: sections.name,
      originalScheduleLabel: sections.originalScheduleLabel,
      courseId: courses.id,
      courseName: courses.name
    })
    .from(sections)
    .innerJoin(courses, eq(sections.courseId, courses.id))
    .innerJoin(
      courseCollaborators,
      and(
        eq(courseCollaborators.courseId, courses.id),
        eq(courseCollaborators.userId, userId),
        eq(courseCollaborators.status, 'accepted')
      )
    )
    .innerJoin(
      schoolMemberships,
      and(
        eq(schoolMemberships.userId, userId),
        eq(schoolMemberships.schoolId, courses.schoolId),
        eq(schoolMemberships.status, 'active')
      )
    )
    .where(
      and(
        eq(sections.id, sectionId),
        eq(sections.teacherId, userId),
        isNull(courseCollaborators.archivedAt)
      )
    )
    .limit(1);

  return row ?? null;
}

async function findOwnedLessonInSectionCourse(userId: string, sectionId: string, lessonId: string) {
  const [row] = await db
    .select({
      sectionId: sections.id,
      lessonId: lessons.id,
      googleSlidesUrl: lessons.googleSlidesUrl,
      googleSlidesStartSlide: lessons.googleSlidesStartSlide
    })
    .from(sections)
    .innerJoin(courses, eq(sections.courseId, courses.id))
    .innerJoin(
      courseCollaborators,
      and(
        eq(courseCollaborators.courseId, courses.id),
        eq(courseCollaborators.userId, userId),
        eq(courseCollaborators.status, 'accepted')
      )
    )
    .innerJoin(
      schoolMemberships,
      and(
        eq(schoolMemberships.userId, userId),
        eq(schoolMemberships.schoolId, courses.schoolId),
        eq(schoolMemberships.status, 'active')
      )
    )
    .innerJoin(units, eq(units.courseId, courses.id))
    .innerJoin(lessons, eq(lessons.unitId, units.id))
    .where(
      and(
        eq(sections.id, sectionId),
        eq(sections.teacherId, userId),
        eq(lessons.id, lessonId),
        isNull(courseCollaborators.archivedAt)
      )
    )
    .limit(1);

  return row ?? null;
}

async function findOwnedUnitInSectionCourse(userId: string, sectionId: string, unitId: string) {
  const [row] = await db
    .select({
      sectionId: sections.id,
      unitId: units.id,
      googleSlidesUrl: units.googleSlidesUrl,
      googleSlidesStartSlide: units.googleSlidesStartSlide
    })
    .from(sections)
    .innerJoin(courses, eq(sections.courseId, courses.id))
    .innerJoin(
      courseCollaborators,
      and(
        eq(courseCollaborators.courseId, courses.id),
        eq(courseCollaborators.userId, userId),
        eq(courseCollaborators.status, 'accepted')
      )
    )
    .innerJoin(
      schoolMemberships,
      and(
        eq(schoolMemberships.userId, userId),
        eq(schoolMemberships.schoolId, courses.schoolId),
        eq(schoolMemberships.status, 'active')
      )
    )
    .innerJoin(units, eq(units.courseId, courses.id))
    .where(
      and(
        eq(sections.id, sectionId),
        eq(sections.teacherId, userId),
        eq(units.id, unitId),
        isNull(courseCollaborators.archivedAt)
      )
    )
    .limit(1);

  return row ?? null;
}

async function buildLessonWorkspace(userId: string, lessonId: string) {
  const [row] = await db
    .select({
      courseId: courses.id,
      courseName: courses.name,
      unitId: units.id,
      unitTitle: units.title,
      googleSlidesUrl: units.googleSlidesUrl,
      googleSlidesStartSlide: units.googleSlidesStartSlide,
      lessonId: lessons.id,
      title: lessons.title,
      description: lessons.description,
      lessonPlan: lessons.lessonPlan,
      lessonGoogleSlidesUrl: lessons.googleSlidesUrl,
      lessonGoogleSlidesStartSlide: lessons.googleSlidesStartSlide,
      orderIndex: lessons.orderIndex,
      estimatedDurationMinutes: lessons.estimatedDurationMinutes,
      plannedStartMeeting: lessons.plannedStartMeeting,
      plannedMeetingCount: lessons.plannedMeetingCount,
      shareEnabled: lessonShares.enabled,
      shareToken: lessonShares.publicToken
    })
    .from(lessons)
    .innerJoin(units, eq(lessons.unitId, units.id))
    .innerJoin(courses, eq(units.courseId, courses.id))
    .innerJoin(
      courseCollaborators,
      and(
        eq(courseCollaborators.courseId, courses.id),
        eq(courseCollaborators.userId, userId),
        eq(courseCollaborators.status, 'accepted')
      )
    )
    .innerJoin(
      schoolMemberships,
      and(
        eq(schoolMemberships.userId, userId),
        eq(schoolMemberships.schoolId, courses.schoolId),
        eq(schoolMemberships.status, 'active')
      )
    )
    .leftJoin(lessonShares, eq(lessonShares.lessonId, lessons.id))
    .where(and(eq(lessons.id, lessonId), isNull(courseCollaborators.archivedAt)))
    .limit(1);
  if (!row) return null;
  const segmentRows = await db
    .select({
      id: lessonSegments.id,
      title: lessonSegments.title,
      description: lessonSegments.description,
      durationMinutes: lessonSegments.durationMinutes,
      stepType: lessonSegments.stepType,
      orderIndex: lessonSegments.orderIndex
    })
    .from(lessonSegments)
    .where(eq(lessonSegments.lessonId, lessonId))
    .orderBy(asc(lessonSegments.orderIndex), asc(lessonSegments.createdAt));
  const sectionRows = await db
    .select({
      id: sections.id,
      name: sections.name,
      status: sectionLessonState.status,
      lastTaughtDate: sectionLessonState.lastTaughtDate
    })
    .from(sections)
    .leftJoin(
      sectionLessonState,
      and(eq(sectionLessonState.sectionId, sections.id), eq(sectionLessonState.lessonId, lessonId))
    )
    .where(and(eq(sections.courseId, row.courseId), eq(sections.teacherId, userId)))
    .orderBy(asc(sections.name));
  return LessonWorkspaceResponseSchema.parse({
    course: { id: row.courseId, name: row.courseName },
    unit: {
      id: row.unitId,
      title: row.unitTitle,
      googleSlidesUrl: row.googleSlidesUrl,
      googleSlidesStartSlide: row.googleSlidesStartSlide
    },
    lesson: {
      id: row.lessonId,
      title: row.title,
      description: row.description,
      lessonPlan: row.lessonPlan,
      googleSlidesUrl: row.lessonGoogleSlidesUrl,
      googleSlidesStartSlide: row.lessonGoogleSlidesStartSlide,
      orderIndex: row.orderIndex,
      estimatedDurationMinutes: row.estimatedDurationMinutes,
      plannedStartMeeting: row.plannedStartMeeting,
      plannedMeetingCount: row.plannedMeetingCount,
      segments: segmentRows
    },
    sections: sectionRows,
    share: { enabled: row.shareEnabled ?? false, token: row.shareToken ?? null }
  });
}

async function buildScheduleResponse(userId: string, schoolId: string) {
  const rows = await db
    .select({
      sectionId: sections.id,
      sectionName: sections.name,
      originalScheduleLabel: sections.originalScheduleLabel,
      courseId: courses.id,
      courseName: courses.name,
      day: sectionMeetings.day,
      meetingTime: sectionMeetings.meetingTime,
      endTime: sectionMeetings.endTime,
      room: sectionMeetings.room
    })
    .from(sections)
    .innerJoin(courses, eq(sections.courseId, courses.id))
    .innerJoin(
      courseCollaborators,
      and(
        eq(courseCollaborators.courseId, courses.id),
        eq(courseCollaborators.userId, userId),
        eq(courseCollaborators.status, 'accepted')
      )
    )
    .innerJoin(
      schoolMemberships,
      and(
        eq(schoolMemberships.userId, userId),
        eq(schoolMemberships.schoolId, courses.schoolId),
        eq(schoolMemberships.status, 'active')
      )
    )
    .leftJoin(sectionMeetings, eq(sectionMeetings.sectionId, sections.id))
    .where(
      and(
        eq(sections.teacherId, userId),
        eq(courses.schoolId, schoolId),
        isNull(courses.archivedAt),
        isNull(courseCollaborators.archivedAt)
      )
    );

  const curriculumIds = [...new Set(rows.map((row) => row.courseId))];
  const localCourseRows = curriculumIds.length
    ? await db
        .select({ curriculumId: teacherCourses.curriculumId, name: teacherCourses.name })
        .from(teacherCourses)
        .where(
          and(
            eq(teacherCourses.teacherId, userId),
            inArray(teacherCourses.curriculumId, curriculumIds)
          )
        )
    : [];
  const localNameByCurriculumId = new Map(
    localCourseRows.map((localCourse) => [localCourse.curriculumId, localCourse.name])
  );

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
      originalScheduleLabel: string | null;
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
        // This is a display label only. A class group always owns its own name
        // and schedule, regardless of which course it uses.
        courseName: localNameByCurriculumId.get(row.courseId) ?? row.courseName,
        sectionName: row.sectionName,
        originalScheduleLabel: row.originalScheduleLabel,
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
  const [localCourse] = await db
    .select()
    .from(teacherCourses)
    .where(and(eq(teacherCourses.teacherId, userId), eq(teacherCourses.curriculumId, courseId)))
    .limit(1);

  const unitRows = await db
    .select({
      id: units.id,
      title: units.title,
      description: units.description,
      orderIndex: units.orderIndex,
      plannedStartMeeting: units.plannedStartMeeting,
      plannedMeetingCount: units.plannedMeetingCount,
      googleSlidesUrl: units.googleSlidesUrl,
      googleSlidesStartSlide: units.googleSlidesStartSlide
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
            lessonPlan: lessons.lessonPlan,
            googleSlidesUrl: lessons.googleSlidesUrl,
            googleSlidesStartSlide: lessons.googleSlidesStartSlide,
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
            stepType: lessonSegments.stepType,
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

  const linkedSections = await db
    .select({ id: sections.id })
    .from(sections)
    .where(and(eq(sections.courseId, courseId), eq(sections.teacherId, userId)));
  const linkedClassGroupCount = linkedSections.length;
  const archivedAt = localCourse?.archivedAt ?? course.archivedAt;
  const lifecycle = archivedAt ? 'ended' : linkedClassGroupCount > 0 ? 'active' : 'unlinked';

  return CourseDetailResponseSchema.parse({
    course: {
      id: course.id,
      curriculumId: course.id,
      curriculumName: course.name,
      relationshipType: localCourse?.relationshipType === 'shared' ? 'shared' : 'independent',
      name: localCourse?.name ?? course.name,
      subject: localCourse?.subject ?? course.subject,
      gradeLevel: localCourse?.gradeLevel ?? course.gradeLevel,
      sortIndex: localCourse?.sortIndex ?? course.sortIndex,
      archivedAt: archivedAt?.toISOString() ?? null,
      createdAt: course.createdAt.toISOString(),
      updatedAt: course.updatedAt.toISOString(),
      accessRole: course.accessRole,
      lifecycle,
      linkedClassGroupCount,
      units: unitRows.map((unit) => ({
        id: unit.id,
        title: unit.title,
        description: unit.description,
        orderIndex: unit.orderIndex,
        plannedStartMeeting: unit.plannedStartMeeting,
        plannedMeetingCount: unit.plannedMeetingCount,
        googleSlidesUrl: unit.googleSlidesUrl,
        googleSlidesStartSlide: unit.googleSlidesStartSlide,
        lessons: (lessonsByUnitId.get(unit.id) ?? []).map((lesson) => ({
          id: lesson.id,
          title: lesson.title,
          description: lesson.description,
          lessonPlan: lesson.lessonPlan,
          googleSlidesUrl: lesson.googleSlidesUrl,
          googleSlidesStartSlide: lesson.googleSlidesStartSlide,
          orderIndex: lesson.orderIndex,
          estimatedDurationMinutes: lesson.estimatedDurationMinutes,
          plannedStartMeeting: lesson.plannedStartMeeting,
          plannedMeetingCount: lesson.plannedMeetingCount,
          segments: (segmentsByLessonId.get(lesson.id) ?? []).map((segment) => ({
            id: segment.id,
            title: segment.title,
            description: segment.description,
            durationMinutes: segment.durationMinutes,
            stepType: segment.stepType,
            orderIndex: segment.orderIndex
          }))
        }))
      }))
    }
  });
}

async function listCoursesForUser(
  userId: string,
  schoolId: string,
  status: 'active' | 'archived' | 'all'
) {
  const courseRows = await db
    .select({
      id: courses.id,
      name: courses.name,
      subject: courses.subject,
      gradeLevel: courses.gradeLevel,
      sortIndex: courses.sortIndex,
      archivedAt: courseCollaborators.archivedAt,
      createdAt: courses.createdAt,
      updatedAt: courses.updatedAt,
      accessRole: courseCollaborators.role
    })
    .from(courses)
    .innerJoin(
      courseCollaborators,
      and(
        eq(courseCollaborators.courseId, courses.id),
        eq(courseCollaborators.userId, userId),
        eq(courseCollaborators.status, 'accepted')
      )
    )
    .innerJoin(
      schoolMemberships,
      and(
        eq(schoolMemberships.userId, userId),
        eq(schoolMemberships.schoolId, schoolId),
        eq(schoolMemberships.status, 'active'),
        eq(schoolMemberships.schoolId, courses.schoolId)
      )
    )
    // Archive status is personal course state. Keep the collaborator join for
    // access, then filter by teacher_courses below.
    .where(undefined)
    .orderBy(asc(courses.sortIndex), asc(courses.name), asc(courses.createdAt));

  const courseIds = courseRows.map((course) => course.id);
  const localCourseRows = courseIds.length
    ? await db
        .select()
        .from(teacherCourses)
        .where(
          and(eq(teacherCourses.teacherId, userId), inArray(teacherCourses.curriculumId, courseIds))
        )
    : [];
  const localByCurriculumId = new Map(
    localCourseRows.map((localCourse) => [localCourse.curriculumId, localCourse])
  );
  const localSections = courseIds.length
    ? await db
        .select({ courseId: sections.courseId })
        .from(sections)
        .where(and(eq(sections.teacherId, userId), inArray(sections.courseId, courseIds)))
    : [];
  const linkedByCourseId = new Map<string, number>();
  for (const section of localSections) {
    linkedByCourseId.set(section.courseId, (linkedByCourseId.get(section.courseId) ?? 0) + 1);
  }

  return courseRows.flatMap((course) => {
    const localCourse = localByCurriculumId.get(course.id);
    const archivedAt = localCourse?.archivedAt ?? course.archivedAt;
    if ((status === 'active' && archivedAt) || (status === 'archived' && !archivedAt)) return [];
    const linkedClassGroupCount = linkedByCourseId.get(course.id) ?? 0;
    return [
      {
        id: course.id,
        curriculumId: course.id,
        curriculumName: course.name,
        relationshipType: localCourse?.relationshipType === 'shared' ? 'shared' : 'independent',
        name: localCourse?.name ?? course.name,
        subject: localCourse?.subject ?? course.subject,
        gradeLevel: localCourse?.gradeLevel ?? course.gradeLevel,
        sortIndex: localCourse?.sortIndex ?? course.sortIndex,
        archivedAt: archivedAt?.toISOString() ?? null,
        createdAt: course.createdAt.toISOString(),
        updatedAt: course.updatedAt.toISOString(),
        accessRole: course.accessRole as 'owner' | 'editor',
        lifecycle: archivedAt
          ? ('ended' as const)
          : linkedClassGroupCount > 0
            ? ('active' as const)
            : ('unlinked' as const),
        linkedClassGroupCount
      }
    ];
  });
}

async function buildCourseCollaborators(courseId: string) {
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      fullName: users.fullName,
      role: courseCollaborators.role,
      status: courseCollaborators.status,
      invitedByUserId: courseCollaborators.invitedByUserId,
      joinedAt: courseCollaborators.joinedAt
    })
    .from(courseCollaborators)
    .innerJoin(users, eq(courseCollaborators.userId, users.id))
    .where(eq(courseCollaborators.courseId, courseId))
    .orderBy(asc(courseCollaborators.createdAt));
  return CourseCollaboratorsResponseSchema.parse({
    collaborators: rows.map((row) => ({
      ...row,
      role: row.role as 'owner' | 'editor',
      status: row.status as 'invited' | 'accepted',
      invitedByUserId: row.invitedByUserId ?? null,
      joinedAt: row.joinedAt?.toISOString() ?? null
    }))
  });
}

type CourseActivitySubjectType = 'course' | 'unit' | 'lesson';

async function recordCourseActivity(
  courseId: string,
  actorUserId: string,
  action: string,
  subjectType: CourseActivitySubjectType,
  subjectId: string | null,
  summary: string,
  options: { dedupe?: boolean; metadata?: Record<string, unknown> } = {}
) {
  // Rich-text autosave can issue several writes in a short burst. Preserve a
  // useful feed by coalescing identical edit events, while never coalescing
  // comments or membership changes.
  if (options.dedupe !== false) {
    const [recent] = await db
      .select({ createdAt: courseActivity.createdAt })
      .from(courseActivity)
      .where(
        and(
          eq(courseActivity.courseId, courseId),
          eq(courseActivity.actorUserId, actorUserId),
          eq(courseActivity.action, action),
          eq(courseActivity.subjectType, subjectType),
          subjectId ? eq(courseActivity.subjectId, subjectId) : isNull(courseActivity.subjectId)
        )
      )
      .orderBy(desc(courseActivity.createdAt))
      .limit(1);
    if (recent && Date.now() - recent.createdAt.getTime() < 5 * 60 * 1000) return;
  }
  await db.insert(courseActivity).values({
    courseId,
    actorUserId,
    action,
    subjectType,
    subjectId,
    summary,
    metadata: options.metadata ?? {}
  });

  const [course] = await db
    .select({ name: courses.name })
    .from(courses)
    .where(eq(courses.id, courseId))
    .limit(1);
  const recipients = await db
    .select({ userId: courseCollaborators.userId })
    .from(courseCollaborators)
    .where(
      and(
        eq(courseCollaborators.courseId, courseId),
        eq(courseCollaborators.status, 'accepted'),
        sql`${courseCollaborators.userId} <> ${actorUserId}`
      )
    );
  if (recipients.length) {
    await db.insert(notifications).values(
      recipients.map((recipient) => ({
        recipientUserId: recipient.userId,
        actorUserId,
        courseId,
        type: 'curriculum_activity',
        title: course?.name ?? 'Shared curriculum',
        message: summary,
        actionUrl: `/sharing?course=${courseId}`
      }))
    );
  }
}

async function createNotification(input: {
  recipientUserId: string;
  actorUserId: string | null;
  courseId?: string | null;
  type: string;
  title: string;
  message: string;
  actionUrl?: string | null;
}) {
  if (input.actorUserId && input.actorUserId === input.recipientUserId) return;
  await db.insert(notifications).values({
    recipientUserId: input.recipientUserId,
    actorUserId: input.actorUserId,
    courseId: input.courseId ?? null,
    type: input.type,
    title: input.title,
    message: input.message,
    actionUrl: input.actionUrl ?? null
  });
}

async function buildCourseActivity(courseId: string, limit: number) {
  const rows = await db
    .select({
      id: courseActivity.id,
      action: courseActivity.action,
      summary: courseActivity.summary,
      subjectType: courseActivity.subjectType,
      subjectId: courseActivity.subjectId,
      createdAt: courseActivity.createdAt,
      actorUserId: users.id,
      actorFullName: users.fullName,
      actorEmail: users.email
    })
    .from(courseActivity)
    .leftJoin(users, eq(courseActivity.actorUserId, users.id))
    .where(eq(courseActivity.courseId, courseId))
    .orderBy(desc(courseActivity.createdAt))
    .limit(limit);
  return CourseActivityResponseSchema.parse({
    activity: rows.map((row) => ({
      id: row.id,
      action: row.action,
      summary: row.summary,
      subjectType: row.subjectType as CourseActivitySubjectType,
      subjectId: row.subjectId ?? null,
      actor:
        row.actorUserId && row.actorEmail
          ? { userId: row.actorUserId, fullName: row.actorFullName, email: row.actorEmail }
          : null,
      createdAt: row.createdAt.toISOString()
    }))
  });
}

async function buildLessonComments(courseId: string, lessonId: string) {
  const rows = await db
    .select({
      id: lessonComments.id,
      courseId: lessonComments.courseId,
      lessonId: lessonComments.lessonId,
      body: lessonComments.body,
      createdAt: lessonComments.createdAt,
      updatedAt: lessonComments.updatedAt,
      authorUserId: users.id,
      authorFullName: users.fullName,
      authorEmail: users.email
    })
    .from(lessonComments)
    .leftJoin(users, eq(lessonComments.authorUserId, users.id))
    .where(and(eq(lessonComments.courseId, courseId), eq(lessonComments.lessonId, lessonId)))
    .orderBy(asc(lessonComments.createdAt));
  return LessonCommentsResponseSchema.parse({
    comments: rows.map((row) => ({
      id: row.id,
      courseId: row.courseId,
      lessonId: row.lessonId,
      body: row.body,
      author:
        row.authorUserId && row.authorEmail
          ? { userId: row.authorUserId, fullName: row.authorFullName, email: row.authorEmail }
          : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    }))
  });
}

async function buildCoursePacing(userId: string, courseId: string) {
  const course = await findOwnedCourse(userId, courseId);
  if (!course) return null;
  const [membership] = await db
    .select({ shareProgress: courseCollaborators.shareProgress })
    .from(courseCollaborators)
    .where(
      and(
        eq(courseCollaborators.courseId, courseId),
        eq(courseCollaborators.userId, userId),
        eq(courseCollaborators.status, 'accepted')
      )
    )
    .limit(1);
  if (!membership) return null;

  const members = await db
    .select({
      userId: users.id,
      fullName: users.fullName,
      email: users.email
    })
    .from(courseCollaborators)
    .innerJoin(users, eq(courseCollaborators.userId, users.id))
    .innerJoin(courses, eq(courseCollaborators.courseId, courses.id))
    .innerJoin(
      schoolMemberships,
      and(
        eq(schoolMemberships.userId, courseCollaborators.userId),
        eq(schoolMemberships.schoolId, courses.schoolId),
        eq(schoolMemberships.status, 'active')
      )
    )
    .where(
      and(
        eq(courseCollaborators.courseId, courseId),
        eq(courseCollaborators.status, 'accepted'),
        or(
          eq(courseCollaborators.userId, userId),
          and(eq(courseCollaborators.shareProgress, true), isNull(courseCollaborators.archivedAt))
        )
      )
    )
    .orderBy(asc(users.fullName), asc(users.email));

  const lessonRows = await db
    .select({
      id: lessons.id,
      title: lessons.title,
      unitOrderIndex: units.orderIndex,
      lessonOrderIndex: lessons.orderIndex
    })
    .from(lessons)
    .innerJoin(units, eq(lessons.unitId, units.id))
    .where(eq(units.courseId, courseId))
    .orderBy(asc(units.orderIndex), asc(lessons.orderIndex), asc(lessons.createdAt));
  const lessonById = new Map(lessonRows.map((lesson, index) => [lesson.id, { ...lesson, index }]));
  const visibleUserIds = members.map((member) => member.userId);
  const sectionRows = visibleUserIds.length
    ? await db
        .select({ id: sections.id, teacherId: sections.teacherId, name: sections.name })
        .from(sections)
        .where(and(eq(sections.courseId, courseId), inArray(sections.teacherId, visibleUserIds)))
        .orderBy(asc(sections.name))
    : [];
  const sectionIds = sectionRows.map((section) => section.id);
  const states =
    sectionIds.length && lessonRows.length
      ? await db
          .select({
            sectionId: sectionLessonState.sectionId,
            lessonId: sectionLessonState.lessonId,
            status: sectionLessonState.status,
            lastTaughtDate: sectionLessonState.lastTaughtDate,
            updatedAt: sectionLessonState.updatedAt
          })
          .from(sectionLessonState)
          .where(
            and(
              inArray(sectionLessonState.sectionId, sectionIds),
              inArray(
                sectionLessonState.lessonId,
                lessonRows.map((lesson) => lesson.id)
              )
            )
          )
      : [];
  const statesBySection = new Map<string, typeof states>();
  for (const state of states) {
    const entries = statesBySection.get(state.sectionId) ?? [];
    entries.push(state);
    statesBySection.set(state.sectionId, entries);
  }

  const progressStates = new Set([
    'in_progress',
    'stopped_at_segment',
    'carried_over',
    'needs_reteach'
  ]);
  const classGroupsByUser = new Map<
    string,
    Array<{
      sectionId: string;
      sectionName: string;
      lessonId: string | null;
      lessonTitle: string | null;
      lessonOrderIndex: number | null;
      status: (typeof states)[number]['status'] | null;
      lastTaughtDate: string | null;
    }>
  >();
  for (const section of sectionRows) {
    const sectionStates = statesBySection.get(section.id) ?? [];
    const active = sectionStates
      .filter((state) => progressStates.has(state.status))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    const completedLessonIds = new Set(
      sectionStates.filter((state) => state.status === 'completed').map((state) => state.lessonId)
    );
    const current =
      active ??
      lessonRows
        .map((lesson) => ({ lessonId: lesson.id, status: null, lastTaughtDate: null }))
        .find((state) => !completedLessonIds.has(state.lessonId)) ??
      null;
    const lesson = current ? lessonById.get(current.lessonId) : null;
    const groups = classGroupsByUser.get(section.teacherId) ?? [];
    groups.push({
      sectionId: section.id,
      sectionName: section.name,
      lessonId: lesson?.id ?? null,
      lessonTitle: lesson?.title ?? null,
      lessonOrderIndex: lesson?.index ?? null,
      status: current?.status ?? null,
      lastTaughtDate: current?.lastTaughtDate ?? null
    });
    classGroupsByUser.set(section.teacherId, groups);
  }

  return CoursePacingResponseSchema.parse({
    sharingEnabled: membership.shareProgress,
    participants: members.map((member) => ({
      ...member,
      isCurrentUser: member.userId === userId,
      classGroups: classGroupsByUser.get(member.userId) ?? []
    }))
  });
}

async function copyCourseCurriculum(
  userId: string,
  sourceCourseId: string,
  targetCourseId: string,
  visibility: 'private' | 'public' = 'private'
) {
  const source = await buildCourseDetail(userId, sourceCourseId);
  if (!source) return false;
  await db.transaction(async (tx) => {
    for (const unit of source.course.units) {
      const [createdUnit] = await tx
        .insert(units)
        .values({
          courseId: targetCourseId,
          title: unit.title,
          description: unit.description,
          orderIndex: unit.orderIndex,
          plannedStartMeeting: unit.plannedStartMeeting,
          plannedMeetingCount: unit.plannedMeetingCount,
          googleSlidesUrl: unit.googleSlidesUrl,
          googleSlidesStartSlide: unit.googleSlidesStartSlide
        })
        .returning({ id: units.id });
      if (!createdUnit) throw new Error('Failed to copy unit');
      for (const lesson of unit.lessons) {
        const [createdLesson] = await tx
          .insert(lessons)
          .values({
            unitId: createdUnit.id,
            title: lesson.title,
            description: lesson.description,
            lessonPlan:
              visibility === 'public'
                ? {
                    objective: lesson.lessonPlan.objective,
                    teacherNotes: null,
                    studentDirections: lesson.lessonPlan.studentDirections,
                    materials: lesson.lessonPlan.materials,
                    links: []
                  }
                : lesson.lessonPlan,
            googleSlidesUrl: lesson.googleSlidesUrl,
            googleSlidesStartSlide: lesson.googleSlidesStartSlide,
            orderIndex: lesson.orderIndex,
            estimatedDurationMinutes: lesson.estimatedDurationMinutes,
            plannedStartMeeting: lesson.plannedStartMeeting,
            plannedMeetingCount: lesson.plannedMeetingCount
          })
          .returning({ id: lessons.id });
        if (!createdLesson) throw new Error('Failed to copy lesson');
        if (lesson.segments.length) {
          await tx.insert(lessonSegments).values(
            lesson.segments.map((step) => ({
              lessonId: createdLesson.id,
              title: step.title,
              description: step.description,
              durationMinutes: step.durationMinutes,
              stepType: step.stepType,
              orderIndex: step.orderIndex
            }))
          );
        }
      }
    }
  });
  return true;
}

async function buildSchoolOverview(userId: string, request?: FastifyRequest) {
  const [profile] = await db
    .select({
      schoolId: schools.id,
      name: schools.name,
      district: schools.district,
      state: schools.state,
      inviteCode: schools.inviteCode
    })
    .from(teacherProfiles)
    .innerJoin(schools, eq(teacherProfiles.schoolId, schools.id))
    .innerJoin(
      schoolMemberships,
      and(
        eq(schoolMemberships.userId, teacherProfiles.userId),
        eq(schoolMemberships.schoolId, teacherProfiles.schoolId),
        eq(schoolMemberships.status, 'active')
      )
    )
    .where(eq(teacherProfiles.userId, userId))
    .limit(1);
  if (!profile) return null;

  const members = await db
    .select({
      userId: users.id,
      email: users.email,
      fullName: users.fullName,
      role: schoolMemberships.role,
      subjects: teacherProfiles.subjects,
      grades: teacherProfiles.grades,
      joinedAt: teacherProfiles.createdAt
    })
    .from(teacherProfiles)
    .innerJoin(users, eq(teacherProfiles.userId, users.id))
    .innerJoin(
      schoolMemberships,
      and(
        eq(schoolMemberships.userId, teacherProfiles.userId),
        eq(schoolMemberships.schoolId, profile.schoolId),
        eq(schoolMemberships.status, 'active')
      )
    )
    .where(eq(teacherProfiles.schoolId, profile.schoolId))
    .orderBy(asc(users.fullName), asc(users.email));

  const libraryRows = await db
    .select({
      courseId: courses.id,
      name: courses.name,
      subject: courses.subject,
      gradeLevel: courses.gradeLevel,
      token: courseShares.publicToken,
      ownerUserId: users.id,
      ownerFullName: users.fullName,
      ownerEmail: users.email
    })
    .from(courseShares)
    .innerJoin(courses, eq(courseShares.courseId, courses.id))
    .innerJoin(users, eq(courses.teacherId, users.id))
    .where(
      and(
        eq(courses.schoolId, profile.schoolId),
        eq(courseShares.enabled, true),
        eq(courseShares.schoolVisible, true)
      )
    )
    .orderBy(asc(courses.name));

  const libraryCourseIds = libraryRows.map((course) => course.courseId);
  const unitRows = libraryCourseIds.length
    ? await db
        .select({ id: units.id, courseId: units.courseId })
        .from(units)
        .where(inArray(units.courseId, libraryCourseIds))
    : [];
  const unitIds = unitRows.map((unit) => unit.id);
  const lessonRows = unitIds.length
    ? await db
        .select({ unitId: lessons.unitId })
        .from(lessons)
        .where(inArray(lessons.unitId, unitIds))
    : [];
  const membershipRows = libraryCourseIds.length
    ? await db
        .select({ courseId: courseCollaborators.courseId })
        .from(courseCollaborators)
        .where(
          and(
            eq(courseCollaborators.userId, userId),
            eq(courseCollaborators.status, 'accepted'),
            inArray(courseCollaborators.courseId, libraryCourseIds)
          )
        )
    : [];
  const unitCounts = new Map<string, number>();
  const courseByUnitId = new Map<string, string>();
  for (const unit of unitRows) {
    unitCounts.set(unit.courseId, (unitCounts.get(unit.courseId) ?? 0) + 1);
    courseByUnitId.set(unit.id, unit.courseId);
  }
  const lessonCounts = new Map<string, number>();
  for (const lesson of lessonRows) {
    const courseId = courseByUnitId.get(lesson.unitId);
    if (courseId) lessonCounts.set(courseId, (lessonCounts.get(courseId) ?? 0) + 1);
  }
  const addedCourseIds = new Set(membershipRows.map((membership) => membership.courseId));

  return SchoolOverviewResponseSchema.parse({
    school: {
      id: profile.schoolId,
      name: profile.name,
      district: profile.district,
      state: profile.state,
      timezone: await loadSchoolTimezone(profile.schoolId, request),
      inviteCode: profile.inviteCode,
      memberCount: members.length
    },
    currentUserId: userId,
    members: members.map((member) => ({
      ...member,
      joinedAt: member.joinedAt.toISOString(),
      isCurrentUser: member.userId === userId
    })),
    curriculumLibrary: libraryRows.map((course) => ({
      courseId: course.courseId,
      name: course.name,
      subject: course.subject,
      gradeLevel: course.gradeLevel,
      unitCount: unitCounts.get(course.courseId) ?? 0,
      lessonCount: lessonCounts.get(course.courseId) ?? 0,
      token: course.token,
      alreadyAdded: addedCourseIds.has(course.courseId),
      owner: {
        userId: course.ownerUserId,
        fullName: course.ownerFullName,
        email: course.ownerEmail
      }
    }))
  });
}

async function buildNotifications(userId: string, limit: number) {
  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      message: notifications.message,
      actionUrl: notifications.actionUrl,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
      actorUserId: users.id,
      actorFullName: users.fullName,
      actorEmail: users.email
    })
    .from(notifications)
    .leftJoin(users, eq(notifications.actorUserId, users.id))
    .where(eq(notifications.recipientUserId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  const [unread] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt)));
  return NotificationListResponseSchema.parse({
    unreadCount: unread?.count ?? 0,
    notifications: rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message,
      actionUrl: row.actionUrl,
      status: row.readAt ? 'read' : 'unread',
      actor:
        row.actorUserId && row.actorEmail
          ? {
              userId: row.actorUserId,
              fullName: row.actorFullName,
              email: row.actorEmail
            }
          : null,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null
    }))
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
    '/v1/schools/search',
    {
      schema: {
        querystring: z.object({ q: z.string().trim().min(2).max(80) }),
        response: { 200: SchoolSearchResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const { q } = z.object({ q: z.string().trim().min(2).max(80) }).parse(request.query);
      const escaped = q.replace(/[\\%_]/g, (character) => `\\${character}`);
      const rows = await db
        .select({
          id: schools.id,
          name: schools.name,
          district: schools.district,
          state: schools.state,
          claimStatus: schools.claimStatus
        })
        .from(schools)
        .where(ilike(schools.name, `%${escaped}%`))
        .orderBy(asc(schools.name))
        .limit(10);
      const ids = rows.map((row) => row.id);
      const memberRows = ids.length
        ? await db
            .select({ schoolId: teacherProfiles.schoolId, count: sql<number>`count(*)::int` })
            .from(teacherProfiles)
            .where(inArray(teacherProfiles.schoolId, ids))
            .groupBy(teacherProfiles.schoolId)
        : [];
      const memberCounts = new Map(memberRows.map((row) => [row.schoolId, row.count]));
      return SchoolSearchResponseSchema.parse({
        schools: rows.map((row) => ({ ...row, memberCount: memberCounts.get(row.id) ?? 0 }))
      });
    }
  );

  app.get(
    '/v1/school',
    { schema: { response: { 200: SchoolOverviewResponseSchema } } },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const overview = await buildSchoolOverview(user.id, request);
      if (!overview) {
        (reply as any).code(404);
        return { error: 'Finish setting up your profile first.', requestId: request.id };
      }
      return overview;
    }
  );

  app.post(
    '/v1/school/join',
    {
      schema: {
        body: SchoolJoinRequestSchema,
        response: { 200: SchoolOverviewResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const body = SchoolJoinRequestSchema.parse(request.body);
      const [school] = await db
        .select({
          id: schools.id,
          claimStatus: schools.claimStatus,
          teacherInvitePolicy: schools.teacherInvitePolicy
        })
        .from(schools)
        .where(eq(schools.inviteCode, body.inviteCode.toUpperCase()))
        .limit(1);
      if (!school) {
        (reply as any).code(404);
        return { error: 'That school invite code is not active.', requestId: request.id };
      }
      if (school.claimStatus === 'claimed' && school.teacherInvitePolicy === 'admin_only') {
        (reply as any).code(403);
        return {
          error: 'This school requires an administrator invitation.',
          requestId: request.id
        };
      }
      const [currentProfile] = await db
        .select({ schoolId: teacherProfiles.schoolId })
        .from(teacherProfiles)
        .where(eq(teacherProfiles.userId, user.id))
        .limit(1);
      if (!currentProfile) {
        (reply as any).code(404);
        return { error: 'Finish setting up your profile first.', requestId: request.id };
      }
      const [targetMembership] = await db
        .select({ role: schoolMemberships.role, status: schoolMemberships.status })
        .from(schoolMemberships)
        .where(
          and(eq(schoolMemberships.userId, user.id), eq(schoolMemberships.schoolId, school.id))
        )
        .limit(1);
      if (currentProfile.schoolId !== school.id) {
        await db.transaction(async (tx) => {
          await tx
            .update(teacherProfiles)
            .set({
              schoolId: school.id,
              role: targetMembership?.role === 'admin' ? 'admin' : 'teacher',
              updatedAt: new Date()
            })
            .where(eq(teacherProfiles.userId, user.id));
          await tx
            .update(schoolMemberships)
            .set({ status: 'inactive', updatedAt: new Date() })
            .where(
              and(
                eq(schoolMemberships.userId, user.id),
                eq(schoolMemberships.schoolId, currentProfile.schoolId)
              )
            );
          await tx
            .insert(schoolMemberships)
            .values({
              userId: user.id,
              schoolId: school.id,
              role:
                targetMembership?.status === 'active' && targetMembership.role === 'admin'
                  ? 'admin'
                  : 'teacher',
              status: 'active'
            })
            .onConflictDoUpdate({
              target: [schoolMemberships.userId, schoolMemberships.schoolId],
              set: {
                role:
                  targetMembership?.status === 'active' && targetMembership.role === 'admin'
                    ? 'admin'
                    : 'teacher',
                status: 'active',
                updatedAt: new Date()
              }
            });
          await tx.insert(auditEvents).values({
            userId: user.id,
            eventType: 'school_joined',
            entityType: 'school',
            entityId: school.id,
            metadata: { previousSchoolId: currentProfile.schoolId }
          });
        });
      } else if (targetMembership?.status === 'inactive') {
        await db.transaction(async (tx) => {
          await tx
            .update(teacherProfiles)
            .set({ role: 'teacher', updatedAt: new Date() })
            .where(eq(teacherProfiles.userId, user.id));
          await tx
            .update(schoolMemberships)
            .set({ role: 'teacher', status: 'active', updatedAt: new Date() })
            .where(
              and(
                eq(schoolMemberships.userId, user.id),
                eq(schoolMemberships.schoolId, school.id),
                eq(schoolMemberships.status, 'inactive')
              )
            );
        });
      }
      const overview = await buildSchoolOverview(user.id, request);
      if (!overview) throw new Error('Could not load joined school');
      return overview;
    }
  );

  app.post(
    '/v1/school-invitations/:invitationId/accept',
    {
      schema: {
        params: z.object({ invitationId: UuidSchema }),
        response: { 200: SchoolInvitationAcceptResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const { invitationId } = z.object({ invitationId: UuidSchema }).parse(request.params);
      const [invitation] = await db
        .select({
          id: schoolInvitations.id,
          schoolId: schoolInvitations.schoolId,
          schoolName: schools.name,
          status: schoolInvitations.status,
          expiresAt: schoolInvitations.expiresAt
        })
        .from(schoolInvitations)
        .innerJoin(schools, eq(schoolInvitations.schoolId, schools.id))
        .where(
          and(eq(schoolInvitations.id, invitationId), eq(schoolInvitations.inviteeUserId, user.id))
        )
        .limit(1);
      if (!invitation) {
        (reply as any).code(404);
        return { error: 'School invitation not found.', requestId: request.id };
      }
      if (invitation.status !== 'pending' || invitation.expiresAt <= new Date()) {
        (reply as any).code(409);
        return { error: 'This school invitation is no longer available.', requestId: request.id };
      }
      const [currentProfile] = await db
        .select({ schoolId: teacherProfiles.schoolId })
        .from(teacherProfiles)
        .where(eq(teacherProfiles.userId, user.id))
        .limit(1);
      if (!currentProfile) {
        (reply as any).code(409);
        return {
          error: 'Complete your TeacherDesk profile before accepting this invitation.',
          requestId: request.id
        };
      }
      await db.transaction(async (tx) => {
        const now = new Date();
        const [accepted] = await tx
          .update(schoolInvitations)
          .set({ status: 'accepted', acceptedAt: now, updatedAt: now })
          .where(
            and(
              eq(schoolInvitations.id, invitation.id),
              eq(schoolInvitations.status, 'pending'),
              gt(schoolInvitations.expiresAt, now)
            )
          )
          .returning({ id: schoolInvitations.id });
        if (!accepted) {
          const error = new Error('This school invitation is no longer available.') as Error & {
            statusCode?: number;
          };
          error.statusCode = 409;
          throw error;
        }
        if (currentProfile.schoolId !== invitation.schoolId) {
          await tx
            .update(teacherProfiles)
            .set({ schoolId: invitation.schoolId, role: 'teacher', updatedAt: now })
            .where(eq(teacherProfiles.userId, user.id));
        }
        // The teacher profile has one active school at a time. Clear every
        // stale membership, not only the profile's previous school, before
        // activating the accepted invitation.
        await tx
          .update(schoolMemberships)
          .set({ status: 'inactive', updatedAt: now })
          .where(
            and(
              eq(schoolMemberships.userId, user.id),
              ne(schoolMemberships.schoolId, invitation.schoolId)
            )
          );
        const [targetMembership] = await tx
          .select({ role: schoolMemberships.role, status: schoolMemberships.status })
          .from(schoolMemberships)
          .where(
            and(
              eq(schoolMemberships.userId, user.id),
              eq(schoolMemberships.schoolId, invitation.schoolId)
            )
          )
          .limit(1);
        await tx
          .insert(schoolMemberships)
          .values({
            userId: user.id,
            schoolId: invitation.schoolId,
            role:
              targetMembership?.status === 'active' && targetMembership.role === 'admin'
                ? 'admin'
                : 'teacher',
            status: 'active',
            updatedAt: now
          })
          .onConflictDoUpdate({
            target: [schoolMemberships.userId, schoolMemberships.schoolId],
            set: {
              role:
                targetMembership?.status === 'active' && targetMembership.role === 'admin'
                  ? 'admin'
                  : 'teacher',
              status: 'active',
              updatedAt: now
            }
          });
        await tx
          .update(notifications)
          .set({ readAt: now })
          .where(
            and(
              eq(notifications.recipientUserId, user.id),
              eq(notifications.type, 'school_invitation'),
              eq(notifications.actionUrl, `/school?schoolInvitation=${invitation.id}`),
              isNull(notifications.readAt)
            )
          );
      });
      return SchoolInvitationAcceptResponseSchema.parse({
        accepted: true,
        schoolId: invitation.schoolId,
        schoolName: invitation.schoolName
      });
    }
  );

  app.get(
    '/v1/notifications',
    { schema: { response: { 200: NotificationListResponseSchema } } },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const { limit } = z
        .object({ limit: z.coerce.number().int().min(1).max(100).default(30) })
        .parse(request.query);
      return buildNotifications(user.id, limit);
    }
  );

  app.patch('/v1/notifications/:notificationId/read', async (request, reply) => {
    const principal = requirePrincipal(request, reply);
    if (!principal) return;
    const user = await ensureUserFromPrincipal(principal);
    const { notificationId } = z.object({ notificationId: UuidSchema }).parse(request.params);
    const [updated] = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, notificationId), eq(notifications.recipientUserId, user.id)))
      .returning({ id: notifications.id });
    if (!updated) {
      (reply as any).code(404);
      return { error: 'Notification not found', requestId: request.id };
    }
    return buildNotifications(user.id, 30);
  });

  app.patch('/v1/notifications/read-all', async (request, reply) => {
    const principal = requirePrincipal(request, reply);
    if (!principal) return;
    const user = await ensureUserFromPrincipal(principal);
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.recipientUserId, user.id), isNull(notifications.readAt)));
    return buildNotifications(user.id, 30);
  });

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

  app.post(
    '/v1/dev/admin-role',
    {
      schema: {
        body: LocalAdminTestRoleRequestSchema,
        response: { 200: LocalAdminTestRoleResponseSchema }
      }
    },
    async (request, reply) => {
      const localTestMode =
        app.config.NODE_ENV === 'test' ||
        (app.config.NODE_ENV === 'development' && app.config.DEV_AUTH_ENABLED);
      if (!localTestMode) {
        (reply as any).code(404);
        return { error: 'Local administrator test mode is unavailable.', requestId: request.id };
      }

      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      const devUserId = request.headers['x-dev-user-id'];
      const isLocalPrincipal =
        principal.clerkUserId === 'pilot-teacher-demo' ||
        principal.clerkUserId.startsWith('test-account:') ||
        (typeof devUserId === 'string' && devUserId === principal.clerkUserId);
      if (!isLocalPrincipal) {
        (reply as any).code(403);
        return {
          error: 'Local administrator test mode requires a local development session.',
          requestId: request.id
        };
      }

      const body = LocalAdminTestRoleRequestSchema.parse(request.body);
      const user = await ensureUserFromPrincipal(principal);
      const [profile] = await db
        .select({
          schoolId: teacherProfiles.schoolId,
          claimStatus: schools.claimStatus,
          claimedByUserId: schools.claimedByUserId
        })
        .from(teacherProfiles)
        .innerJoin(schools, eq(schools.id, teacherProfiles.schoolId))
        .where(eq(teacherProfiles.userId, user.id))
        .limit(1);
      if (!profile) {
        (reply as any).code(409);
        return {
          error: 'Complete your local profile before changing the administrator test role.',
          requestId: request.id
        };
      }

      const [membership] = await db
        .select({ role: schoolMemberships.role, status: schoolMemberships.status })
        .from(schoolMemberships)
        .where(
          and(
            eq(schoolMemberships.userId, user.id),
            eq(schoolMemberships.schoolId, profile.schoolId)
          )
        )
        .limit(1);
      if (!membership || membership.status !== 'active') {
        (reply as any).code(409);
        return { error: 'An active local school membership is required.', requestId: request.id };
      }

      if (
        body.role === 'admin' &&
        profile.claimStatus === 'claimed' &&
        profile.claimedByUserId !== user.id
      ) {
        (reply as any).code(409);
        return {
          error: 'This school is claimed by another administrator. Use the normal claim flow.',
          requestId: request.id
        };
      }
      if (body.role === 'teacher' && profile.claimStatus === 'claimed') {
        (reply as any).code(409);
        return {
          error: 'The local test role cannot remove access from a claimed school.',
          requestId: request.id
        };
      }

      await db.transaction(async (tx) => {
        await tx
          .update(schoolMemberships)
          .set({ role: body.role, updatedAt: new Date() })
          .where(
            and(
              eq(schoolMemberships.userId, user.id),
              eq(schoolMemberships.schoolId, profile.schoolId),
              eq(schoolMemberships.status, 'active')
            )
          );
        await tx
          .update(teacherProfiles)
          .set({ role: body.role, updatedAt: new Date() })
          .where(
            and(eq(teacherProfiles.userId, user.id), eq(teacherProfiles.schoolId, profile.schoolId))
          );
      });

      return LocalAdminTestRoleResponseSchema.parse({
        role: body.role,
        schoolId: profile.schoolId,
        temporary: true,
        message:
          body.role === 'admin'
            ? 'Temporary administrator mode is enabled. Your classes and course ownership are unchanged; use the Teaching workspace when you want to teach.'
            : 'Temporary administrator mode is disabled. Your teaching workspace is active again.'
      });
    }
  );

  app.patch(
    '/v1/courses/:courseId/planning-range',
    {
      schema: {
        params: CourseParamsSchema,
        body: CurriculumRangeCreateRequestSchema,
        response: { 200: CourseDetailResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = CourseParamsSchema.parse(request.params);
      const body = CurriculumRangeCreateRequestSchema.parse(request.body);
      if (!(await findOwnedCourse(user.id, params.courseId))) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }

      await db.transaction(async (tx) => {
        let unitId: string;
        let lessonTitles: string[];
        if (body.kind === 'unit') {
          const [lastUnit] = await tx
            .select({ orderIndex: units.orderIndex })
            .from(units)
            .where(eq(units.courseId, params.courseId))
            .orderBy(desc(units.orderIndex))
            .limit(1);
          const [unit] = await tx
            .insert(units)
            .values({
              courseId: params.courseId,
              title: body.title,
              description: body.description ?? null,
              orderIndex: (lastUnit?.orderIndex ?? -1) + 1,
              plannedStartMeeting: body.plannedStartMeeting,
              plannedMeetingCount: body.plannedMeetingCount
            })
            .returning({ id: units.id });
          if (!unit) throw new Error('Could not create unit');
          unitId = unit.id;
          lessonTitles = body.lessonTitles;
        } else {
          const [unit] = await tx
            .select({ id: units.id })
            .from(units)
            .where(and(eq(units.id, body.unitId), eq(units.courseId, params.courseId)))
            .limit(1);
          if (!unit) throw new Error('Unit not found in this course');
          unitId = unit.id;
          lessonTitles = body.lessonTitles;
        }

        if (!lessonTitles.length) return;
        const [lastLesson] = await tx
          .select({ orderIndex: lessons.orderIndex })
          .from(lessons)
          .where(eq(lessons.unitId, unitId))
          .orderBy(desc(lessons.orderIndex))
          .limit(1);
        const baseSpan = Math.floor(body.plannedMeetingCount / lessonTitles.length);
        const remainder = body.plannedMeetingCount % lessonTitles.length;
        let meetingCursor = body.plannedStartMeeting;
        await tx.insert(lessons).values(
          lessonTitles.map((title, index) => {
            const span = Math.max(1, baseSpan + (index < remainder ? 1 : 0));
            const plannedStartMeeting =
              baseSpan === 0
                ? body.plannedStartMeeting +
                  Math.floor((index * body.plannedMeetingCount) / lessonTitles.length)
                : meetingCursor;
            if (baseSpan > 0) meetingCursor += span;
            return {
              unitId,
              title,
              description: null,
              estimatedDurationMinutes: 45,
              orderIndex: (lastLesson?.orderIndex ?? -1) + 1 + index,
              plannedStartMeeting,
              plannedMeetingCount: span
            };
          })
        );
      });
      const detail = await buildCourseDetail(user.id, params.courseId);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.patch(
    '/v1/lessons/:lessonId/segments/reorder',
    {
      schema: {
        params: LessonParamsSchema,
        body: SegmentReorderRequestSchema,
        response: { 200: CourseDetailResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = LessonParamsSchema.parse(request.params);
      const body = SegmentReorderRequestSchema.parse(request.body);
      const courseId = await findOwnedCourseIdForLesson(user.id, params.lessonId);
      if (!courseId) {
        (reply as any).code(404);
        return { error: 'Lesson not found', requestId: request.id };
      }

      await db.transaction(async (tx) => {
        const current = await tx
          .select({ id: lessonSegments.id })
          .from(lessonSegments)
          .where(eq(lessonSegments.lessonId, params.lessonId));
        const currentIds = current.map((segment) => segment.id).sort();
        const requestedIds = [...body.segmentIds].sort();
        if (
          currentIds.length !== requestedIds.length ||
          currentIds.some((id, index) => id !== requestedIds[index])
        ) {
          throw new Error('Lesson steps changed. Refresh and try reordering again.');
        }

        // Use a temporary range so this remains safe even if a future schema
        // adds a uniqueness constraint on (lesson_id, order_index).
        for (const [index, segmentId] of body.segmentIds.entries()) {
          await tx
            .update(lessonSegments)
            .set({ orderIndex: -1 - index })
            .where(eq(lessonSegments.id, segmentId));
        }
        for (const [index, segmentId] of body.segmentIds.entries()) {
          await tx
            .update(lessonSegments)
            .set({ orderIndex: index })
            .where(eq(lessonSegments.id, segmentId));
        }
      });
      const detail = await buildCourseDetail(user.id, courseId);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
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

  app.post(
    '/v1/account/reset',
    {
      schema: {
        body: AccountResetRequestSchema,
        response: { 200: AccountResetResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      // Require an explicit typed confirmation so a reset cannot be triggered
      // accidentally by normal navigation or a stale client.
      AccountResetRequestSchema.parse(request.body);
      const user = await ensureUserFromPrincipal(principal);

      await db.transaction(async (tx) => {
        const [profile] = await tx
          .select({ schoolId: teacherProfiles.schoolId })
          .from(teacherProfiles)
          .where(eq(teacherProfiles.userId, user.id))
          .limit(1);

        if (profile) {
          const [adminMembership] = await tx
            .select({ role: schoolMemberships.role })
            .from(schoolMemberships)
            .where(
              and(
                eq(schoolMemberships.userId, user.id),
                eq(schoolMemberships.schoolId, profile.schoolId),
                eq(schoolMemberships.role, 'admin'),
                eq(schoolMemberships.status, 'active')
              )
            )
            .limit(1);
          if (adminMembership) {
            const [school] = await tx
              .select({ claimStatus: schools.claimStatus })
              .from(schools)
              .where(eq(schools.id, profile.schoolId))
              .limit(1);
            const [activeAdministratorCount] = await tx
              .select({ count: sql<number>`count(*)::int` })
              .from(schoolMemberships)
              .where(
                and(
                  eq(schoolMemberships.schoolId, profile.schoolId),
                  eq(schoolMemberships.role, 'admin'),
                  eq(schoolMemberships.status, 'active')
                )
              );
            if (school?.claimStatus === 'claimed' && (activeAdministratorCount?.count ?? 0) <= 1) {
              const error = new Error(
                'Transfer school administrator access before resetting this account.'
              ) as Error & { statusCode?: number };
              error.statusCode = 409;
              throw error;
            }
          }
        }

        // Course deletion cascades through sections, lessons, lesson state,
        // meeting overrides, notes, and curriculum. AI outputs cascade with
        // their jobs. The users row is deliberately never touched.
        await tx.delete(courses).where(eq(courses.teacherId, user.id));
        await tx.delete(aiJobs).where(eq(aiJobs.userId, user.id));
        await tx.delete(auditEvents).where(eq(auditEvents.userId, user.id));
        await tx.delete(teacherPreferences).where(eq(teacherPreferences.userId, user.id));
        await tx
          .delete(schoolClaimRequests)
          .where(eq(schoolClaimRequests.requesterUserId, user.id));
        await tx.delete(courseCollaborators).where(eq(courseCollaborators.userId, user.id));
        await tx.delete(notifications).where(eq(notifications.recipientUserId, user.id));
        await tx.delete(schoolMemberships).where(eq(schoolMemberships.userId, user.id));
        await tx.delete(teacherProfiles).where(eq(teacherProfiles.userId, user.id));

        if (profile) {
          const [anotherProfile] = await tx
            .select({ userId: teacherProfiles.userId })
            .from(teacherProfiles)
            .where(eq(teacherProfiles.schoolId, profile.schoolId))
            .limit(1);

          // School calendars may be shared, so erase one only when this
          // account was its last member.
          if (!anotherProfile) {
            await tx.delete(schools).where(eq(schools.id, profile.schoolId));
          }
        }
      });

      return AccountResetResponseSchema.parse({ reset: true });
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
      const schoolId = await loadTeacherSchoolId(user.id);
      const timezone = await loadSchoolTimezone(schoolId, request);
      const isoDate = localDateFor(date, timezone);
      const cacheKey = `dashboard:today:v3:${user.id}:${timezone}:${isoDate}`;

      const cached = await safeRedisGet(app.redis, cacheKey);
      if (cached) {
        return JSON.parse(cached) as unknown;
      }

      const allMeetingInstances = await buildMeetingInstances(user.id, schoolId, {
        startDate: isoDate,
        endDate: isoDate,
        timeZone: timezone
      });
      const resolved = resolveTodayMeetings(allMeetingInstances.meetings, date, timezone);
      const todaySchedule = resolved.todaySchedule.map((meeting) => ({
        sectionId: meeting.sectionId,
        sectionName: meeting.sectionName,
        courseName: meeting.courseName,
        meetingTime: meeting.startTime,
        endTime: meeting.endTime,
        room: meeting.room,
        isInSession: meeting.isInSession,
        status: meeting.status
      }));
      const activeYear = await loadActiveSchoolYear(schoolId, timezone);
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
      const [legacyHoliday] = await db
        .select({ id: schoolHolidays.id, date: schoolHolidays.date, name: schoolHolidays.name })
        .from(schoolHolidays)
        .where(and(eq(schoolHolidays.schoolId, schoolId), eq(schoolHolidays.date, isoDate)))
        .limit(1);

      const currentClass = resolved.currentClass;
      const nextClass = resolved.nextClass;

      const response = {
        date: isoDate,
        currentClass: currentClass
          ? {
              sectionId: currentClass.sectionId,
              courseName: currentClass.courseName,
              sectionName: currentClass.sectionName,
              meetingTime: currentClass.startTime,
              endTime: currentClass.endTime,
              room: currentClass.room
            }
          : null,
        nextClass: nextClass
          ? {
              sectionId: nextClass.sectionId,
              courseName: nextClass.courseName,
              sectionName: nextClass.sectionName,
              meetingTime: nextClass.startTime,
              endTime: nextClass.endTime
            }
          : null,
        todaySchedule,
        holiday:
          calendarClosure || legacyHoliday
            ? {
                id: (calendarClosure ?? legacyHoliday)!.id,
                date: (calendarClosure ?? legacyHoliday)!.date,
                name: (calendarClosure ?? legacyHoliday)!.name
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
      return buildSchoolCalendarResponse(await loadTeacherSchoolId(user.id), undefined, request);
    }
  );

  app.patch(
    '/v1/school/timezone',
    {
      schema: {
        body: SchoolTimezoneUpdateRequestSchema,
        response: { 200: SchoolCalendarResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const body = SchoolTimezoneUpdateRequestSchema.parse(request.body);
      const timezone = validTimeZone(body.timezone);
      if (!timezone) {
        (reply as any).code(400);
        return { error: 'Timezone must be a valid IANA timezone', requestId: request.id };
      }
      const schoolId = await loadTeacherSchoolId(user.id);
      if (!(await assertSchoolCalendarWriteAccess(user.id, schoolId, request, reply))) return;
      await db
        .update(schools)
        .set({ timezone, updatedAt: new Date() })
        .where(eq(schools.id, schoolId));
      return buildSchoolCalendarResponse(schoolId, undefined, request);
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
      if (!(await assertSchoolCalendarWriteAccess(user.id, schoolId, request, reply))) return;
      const body = SchoolYearUpsertRequestSchema.parse(request.body);
      const activeSchoolYear = await loadActiveSchoolYear(
        schoolId,
        await loadSchoolTimezone(schoolId, request)
      );
      // Editing dates is an edit of the school's current instructional year,
      // not a second empty year that would disconnect its imported calendar.
      const { schoolYear, created } = activeSchoolYear
        ? {
            schoolYear:
              activeSchoolYear.startDate === body.startDate &&
              activeSchoolYear.endDate === body.endDate
                ? activeSchoolYear
                : (
                    await db
                      .update(schoolYears)
                      .set({ ...body, updatedAt: new Date() })
                      .where(eq(schoolYears.id, activeSchoolYear.id))
                      .returning()
                  )[0]!,
            created: false
          }
        : await findOrCreateSchoolYear(schoolId, user.id, body);
      await db.insert(auditEvents).values({
        userId: user.id,
        eventType: created ? 'school_year_created' : 'school_year_saved',
        entityType: 'school_year',
        entityId: schoolYear.id,
        metadata: body
      });
      return buildSchoolCalendarResponse(schoolId, schoolYear.id, request);
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
        .where(eq(sections.teacherId, user.id));
      // One structured call reads the calendar, identifies the instructional
      // year, and extracts exceptions. The previous two-pass flow uploaded the
      // same document twice and routinely exceeded the request deadline.
      const result = await runStructuredPrompt<z.infer<typeof InternalCalendarImportSchema>>({
        apiKey: app.config.OPENAI_API_KEY,
        model: app.config.OPENAI_MODEL_PARSE_SCHEDULE,
        reasoningEffort: 'low',
        schemaName: 'school_calendar_import',
        schema: InternalCalendarImportSchema,
        systemPrompt:
          'You are a careful school calendar reader. Extract only evidence visible in the teacher supplied calendar.',
        userPrompt: calendarImportPrompt(
          body,
          classGroups.map((group) => group.name)
        ),
        fileDataUrl: scheduleImportFileDataUrl(body),
        fileName: body.fileName,
        maxAttempts: 1
      });
      return CalendarImportResponseSchema.parse({
        ...result,
        ignoredEvents: result.ignoredEvents.map(({ date, ...event }) => ({
          ...event,
          ...(date ? { date } : {})
        }))
      });
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
      if (!(await assertSchoolCalendarWriteAccess(user.id, schoolId, request, reply))) return;
      const { schoolYear } = await findOrCreateSchoolYear(schoolId, user.id, body.schoolYear);
      const approved = body.approvedEventKeys ? new Set(body.approvedEventKeys) : null;
      const events = body.events.filter(
        (event) => !approved || approved.has(instructionalExceptionKey(event))
      );
      await db.transaction(async (tx) => {
        if (body.mode === 'replace')
          await tx
            .delete(schoolCalendarEvents)
            .where(eq(schoolCalendarEvents.schoolYearId, schoolYear.id));
        const existingEvents =
          body.mode === 'merge'
            ? await tx
                .select()
                .from(schoolCalendarEvents)
                .where(eq(schoolCalendarEvents.schoolYearId, schoolYear.id))
            : [];
        for (const event of events) {
          for (const date of expandInstructionalException(event)) {
            // A new import often varies harmlessly in capitalization or adds a
            // descriptor ("Ski Day / No Regular Classes"). Avoid duplicating
            // an already-saved instructional exception in that case.
            if (
              body.mode === 'merge' &&
              existingEvents.some(
                (existing) =>
                  existing.date === date &&
                  existing.type === event.type &&
                  calendarTitlesMatch(existing.label, event.title)
              )
            )
              continue;
            const values = {
              schoolYearId: schoolYear.id,
              date,
              type: event.type,
              label: event.title,
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
        }
        const ownedSections = await tx
          .select({ id: sections.id, name: sections.name })
          .from(sections)
          .innerJoin(courses, eq(sections.courseId, courses.id))
          .where(and(eq(sections.teacherId, user.id), eq(courses.schoolId, schoolId)));
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
              occurrenceKey: override.occurrenceKey,
              startTime: override.startTime,
              endTime: override.endTime,
              room: override.room,
              cancelled: override.cancelled,
              createdByUserId: user.id
            })
            .onConflictDoUpdate({
              target: [
                sectionMeetingOverrides.sectionId,
                sectionMeetingOverrides.date,
                sectionMeetingOverrides.occurrenceKey
              ],
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
      return buildSchoolCalendarResponse(schoolId, schoolYear.id, request);
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
      const schoolId = await loadTeacherSchoolId(user.id);
      return buildMeetingInstances(user.id, schoolId, {
        ...query,
        timeZone: await loadSchoolTimezone(schoolId, request)
      });
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
            teacherId: user.id,
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

      if (body.courseId !== undefined && !(await findOwnedCourse(user.id, body.courseId))) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }

      await db.transaction(async (tx) => {
        if (body.courseId !== undefined && body.courseId !== ownedSection.courseId) {
          await tx
            .update(sections)
            .set({ courseId: body.courseId, updatedAt: new Date() })
            .where(eq(sections.id, params.sectionId));
        }
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
      const occurrenceKey = meetingOccurrenceKey(body.scheduledStartTime);
      await db
        .insert(sectionMeetingOverrides)
        .values({
          sectionId: params.sectionId,
          date: body.date,
          occurrenceKey,
          startTime: body.startTime,
          endTime: body.endTime,
          room: body.room,
          cancelled: body.cancelled,
          createdByUserId: user.id
        })
        .onConflictDoUpdate({
          target: [
            sectionMeetingOverrides.sectionId,
            sectionMeetingOverrides.date,
            sectionMeetingOverrides.occurrenceKey
          ],
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
      const schoolId = await loadTeacherSchoolId(user.id);
      return buildMeetingInstances(user.id, schoolId, {
        sectionId: params.sectionId,
        timeZone: await loadSchoolTimezone(schoolId, request)
      });
    }
  );

  app.post(
    '/v1/sections/:sectionId/lesson-plans/shift',
    {
      schema: {
        params: SectionParamsSchema,
        body: SectionLessonPlanShiftRequestSchema,
        response: { 200: SectionLessonPlanResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = SectionParamsSchema.parse(request.params);
      const body = SectionLessonPlanShiftRequestSchema.parse(request.body);
      const ownedSection = await findOwnedSection(user.id, params.sectionId);
      if (
        !ownedSection ||
        !(await findOwnedLessonInSectionCourse(user.id, params.sectionId, body.lessonId))
      ) {
        (reply as any).code(404);
        return { error: 'Section or lesson not found', requestId: request.id };
      }

      const result = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`section-plan:${params.sectionId}`}))`
        );
        const curriculum = await tx
          .select({
            lessonId: lessons.id,
            title: lessons.title,
            courseStart: lessons.plannedStartMeeting,
            courseCount: lessons.plannedMeetingCount,
            overrideStart: sectionLessonPlans.plannedStartMeeting,
            overrideCount: sectionLessonPlans.plannedMeetingCount,
            overrideId: sectionLessonPlans.id
          })
          .from(lessons)
          .innerJoin(units, eq(lessons.unitId, units.id))
          .leftJoin(
            sectionLessonPlans,
            and(
              eq(sectionLessonPlans.lessonId, lessons.id),
              eq(sectionLessonPlans.sectionId, params.sectionId)
            )
          )
          .where(eq(units.courseId, ownedSection.courseId))
          .orderBy(asc(units.orderIndex), asc(lessons.orderIndex), asc(lessons.createdAt));
        const target = curriculum.find((lesson) => lesson.lessonId === body.lessonId);
        const targetStart = target?.overrideStart ?? target?.courseStart ?? null;
        if (!target || targetStart === null) {
          throw new Error('This lesson needs a planned meeting before it can be shifted.');
        }
        const affected = curriculum.filter((lesson) => {
          const start = lesson.overrideStart ?? lesson.courseStart;
          return start !== null && start >= targetStart;
        });
        const previousOverrides = affected.map((lesson) => ({
          lessonId: lesson.lessonId,
          existed: Boolean(lesson.overrideId),
          plannedStartMeeting: lesson.overrideStart,
          plannedMeetingCount: lesson.overrideCount
        }));
        for (const lesson of affected) {
          const effectiveStart = lesson.overrideStart ?? lesson.courseStart;
          const effectiveCount = lesson.overrideCount ?? lesson.courseCount;
          if (effectiveStart === null) continue;
          await tx
            .insert(sectionLessonPlans)
            .values({
              sectionId: params.sectionId,
              lessonId: lesson.lessonId,
              plannedStartMeeting: Math.max(0, effectiveStart + body.meetingDelta),
              plannedMeetingCount: effectiveCount
            })
            .onConflictDoUpdate({
              target: [sectionLessonPlans.sectionId, sectionLessonPlans.lessonId],
              set: {
                plannedStartMeeting: Math.max(0, effectiveStart + body.meetingDelta),
                plannedMeetingCount: effectiveCount,
                revision: sql`${sectionLessonPlans.revision} + 1`,
                updatedAt: new Date()
              }
            });
        }
        const [operation] = await tx
          .insert(sectionPlanOperations)
          .values({
            sectionId: params.sectionId,
            courseId: ownedSection.courseId,
            kind: 'shift_forward',
            previousOverrides
          })
          .returning({ id: sectionPlanOperations.id });
        const plans = await tx
          .select({
            lessonId: sectionLessonPlans.lessonId,
            plannedStartMeeting: sectionLessonPlans.plannedStartMeeting,
            plannedMeetingCount: sectionLessonPlans.plannedMeetingCount,
            revision: sectionLessonPlans.revision
          })
          .from(sectionLessonPlans)
          .where(eq(sectionLessonPlans.sectionId, params.sectionId));
        return { operationId: operation?.id ?? null, plans };
      });
      return SectionLessonPlanResponseSchema.parse(result);
    }
  );

  app.get(
    '/v1/sections/:sectionId/lesson-plans',
    {
      schema: {
        params: SectionParamsSchema,
        response: { 200: SectionLessonPlanResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = SectionParamsSchema.parse(request.params);
      if (!(await findOwnedSection(user.id, params.sectionId))) {
        (reply as any).code(404);
        return { error: 'Section not found', requestId: request.id };
      }
      const plans = await db
        .select({
          lessonId: sectionLessonPlans.lessonId,
          plannedStartMeeting: sectionLessonPlans.plannedStartMeeting,
          plannedMeetingCount: sectionLessonPlans.plannedMeetingCount,
          revision: sectionLessonPlans.revision
        })
        .from(sectionLessonPlans)
        .where(eq(sectionLessonPlans.sectionId, params.sectionId));
      return SectionLessonPlanResponseSchema.parse({ operationId: null, plans });
    }
  );

  app.post(
    '/v1/sections/:sectionId/lesson-plans/:operationId/undo',
    {
      schema: {
        params: SectionParamsSchema.extend({ operationId: UuidSchema }),
        response: { 200: SectionLessonPlanResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = SectionParamsSchema.extend({ operationId: UuidSchema }).parse(request.params);
      const ownedSection = await findOwnedSection(user.id, params.sectionId);
      if (!ownedSection) {
        (reply as any).code(404);
        return { error: 'Section not found', requestId: request.id };
      }
      try {
        const result = await db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext(${`section-plan:${params.sectionId}`}))`
          );
          const [operation] = await tx
            .select()
            .from(sectionPlanOperations)
            .where(
              and(
                eq(sectionPlanOperations.id, params.operationId),
                eq(sectionPlanOperations.sectionId, params.sectionId),
                eq(sectionPlanOperations.courseId, ownedSection.courseId)
              )
            )
            .limit(1);
          if (!operation) {
            throw new SectionPlanUndoConflictError(
              'Planning operation not found or already undone.'
            );
          }
          const [latestOperation] = await tx
            .select({ id: sectionPlanOperations.id })
            .from(sectionPlanOperations)
            .where(
              and(
                eq(sectionPlanOperations.sectionId, params.sectionId),
                eq(sectionPlanOperations.courseId, ownedSection.courseId)
              )
            )
            .orderBy(desc(sectionPlanOperations.createdAt), desc(sectionPlanOperations.id))
            .limit(1);
          if (latestOperation?.id !== operation.id) {
            throw new SectionPlanUndoConflictError(
              'Only the most recent section planning change can be undone.'
            );
          }
          const previous = operation.previousOverrides as Array<{
            lessonId: string;
            existed?: boolean;
            plannedStartMeeting: number | null;
            plannedMeetingCount: number | null;
          }>;
          for (const item of previous) {
            if (!item.existed) {
              await tx
                .delete(sectionLessonPlans)
                .where(
                  and(
                    eq(sectionLessonPlans.sectionId, params.sectionId),
                    eq(sectionLessonPlans.lessonId, item.lessonId)
                  )
                );
              continue;
            }
            await tx
              .insert(sectionLessonPlans)
              .values({
                sectionId: params.sectionId,
                lessonId: item.lessonId,
                plannedStartMeeting: item.plannedStartMeeting,
                plannedMeetingCount: item.plannedMeetingCount
              })
              .onConflictDoUpdate({
                target: [sectionLessonPlans.sectionId, sectionLessonPlans.lessonId],
                set: {
                  plannedStartMeeting: item.plannedStartMeeting,
                  plannedMeetingCount: item.plannedMeetingCount,
                  revision: sql`${sectionLessonPlans.revision} + 1`,
                  updatedAt: new Date()
                }
              });
          }
          await tx.delete(sectionPlanOperations).where(eq(sectionPlanOperations.id, operation.id));
          const plans = await tx
            .select({
              lessonId: sectionLessonPlans.lessonId,
              plannedStartMeeting: sectionLessonPlans.plannedStartMeeting,
              plannedMeetingCount: sectionLessonPlans.plannedMeetingCount,
              revision: sectionLessonPlans.revision
            })
            .from(sectionLessonPlans)
            .where(eq(sectionLessonPlans.sectionId, params.sectionId));
          return { operationId: null, plans };
        });
        return SectionLessonPlanResponseSchema.parse(result);
      } catch (error) {
        if (error instanceof SectionPlanUndoConflictError) {
          (reply as any).code(409);
          return { error: error.message, requestId: request.id };
        }
        throw error;
      }
    }
  );

  app.get(
    '/v1/sections/:sectionId/planning-context',
    {
      schema: {
        params: SectionParamsSchema,
        querystring: SectionPlanningContextQuerySchema,
        response: { 200: SectionPlanningContextResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = SectionParamsSchema.parse(request.params);
      const query = SectionPlanningContextQuerySchema.parse(request.query);
      const ownedSection = await findOwnedSection(user.id, params.sectionId);
      if (!ownedSection) {
        (reply as any).code(404);
        return { error: 'Section not found', requestId: request.id };
      }
      const curriculum = await db
        .select({
          lessonId: lessons.id,
          title: lessons.title,
          courseStart: lessons.plannedStartMeeting,
          courseCount: lessons.plannedMeetingCount,
          sectionStart: sectionLessonPlans.plannedStartMeeting,
          sectionCount: sectionLessonPlans.plannedMeetingCount,
          sectionPlanId: sectionLessonPlans.id
        })
        .from(lessons)
        .innerJoin(units, eq(lessons.unitId, units.id))
        .leftJoin(
          sectionLessonPlans,
          and(
            eq(sectionLessonPlans.lessonId, lessons.id),
            eq(sectionLessonPlans.sectionId, params.sectionId)
          )
        )
        .where(eq(units.courseId, ownedSection.courseId))
        .orderBy(asc(units.orderIndex), asc(lessons.orderIndex), asc(lessons.createdAt));
      const planned = curriculum.find((lesson) => {
        const start = lesson.sectionStart ?? lesson.courseStart;
        const count = lesson.sectionCount ?? lesson.courseCount;
        return (
          start !== null &&
          count !== null &&
          query.meetingIndex >= start &&
          query.meetingIndex < start + count
        );
      });
      const [actual] = await db
        .select({
          lessonId: sectionLessonState.lessonId,
          status: sectionLessonState.status,
          completedStepIds: sectionLessonState.completedSegmentIds,
          stoppedAtStepId: sectionLessonState.stoppedAtSegmentId
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
      return SectionPlanningContextResponseSchema.parse({
        planned: planned
          ? {
              lessonId: planned.lessonId,
              title: planned.title,
              plannedStartMeeting: planned.sectionStart ?? planned.courseStart,
              plannedMeetingCount: planned.sectionCount ?? planned.courseCount,
              source: planned.sectionPlanId ? 'section' : 'course'
            }
          : null,
        actual: actual ?? null
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

      const orderedLessons = await db
        .select({ id: lessons.id, status: sectionLessonState.status })
        .from(lessons)
        .innerJoin(units, eq(lessons.unitId, units.id))
        .leftJoin(
          sectionLessonState,
          and(
            eq(sectionLessonState.lessonId, lessons.id),
            eq(sectionLessonState.sectionId, params.sectionId)
          )
        )
        .where(eq(units.courseId, ownedSection.courseId))
        .orderBy(asc(units.orderIndex), asc(lessons.orderIndex), asc(lessons.createdAt));

      const firstLesson = orderedLessons.find(
        (candidate) => candidate.status !== 'completed' && candidate.status !== 'skipped'
      );
      const lessonId = activeState?.lessonId ?? firstLesson?.id ?? null;

      const [lesson] = lessonId
        ? await db
            .select({
              id: lessons.id,
              title: lessons.title,
              description: lessons.description,
              lessonPlan: lessons.lessonPlan,
              googleSlidesUrl: lessons.googleSlidesUrl,
              googleSlidesStartSlide: lessons.googleSlidesStartSlide,
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
              stepType: lessonSegments.stepType,
              orderIndex: lessonSegments.orderIndex
            })
            .from(lessonSegments)
            .where(eq(lessonSegments.lessonId, lessonId))
            .orderBy(asc(lessonSegments.orderIndex), asc(lessonSegments.createdAt))
        : [];

      const recentMeetingNotes = await db
        .select({
          id: classMeetings.id,
          date: classMeetings.meetingDate,
          content: classMeetings.rawNote,
          updatedAt: classMeetings.updatedAt
        })
        .from(classMeetings)
        .where(eq(classMeetings.sectionId, params.sectionId))
        .orderBy(desc(classMeetings.meetingDate), desc(classMeetings.updatedAt))
        .limit(25);
      const lastMeetingNote = recentMeetingNotes.find((note) => note.content !== null) ?? null;
      const [lastLegacyNote] = await db
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
              lessonPlan: lesson.lessonPlan,
              googleSlidesUrl: lesson.googleSlidesUrl,
              googleSlidesStartSlide: lesson.googleSlidesStartSlide,
              orderIndex: lesson.orderIndex,
              estimatedDurationMinutes: lesson.estimatedDurationMinutes,
              plannedStartMeeting: null,
              plannedMeetingCount: null,
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
        progress: orderedLessons
          .filter((item) => item.status !== null)
          .map((item) => ({ lessonId: item.id, status: item.status! })),
        lastNote:
          (lastMeetingNote ?? lastLegacyNote)
            ? {
                noteId: lastMeetingNote?.id ?? lastLegacyNote!.noteId,
                date: lastMeetingNote?.date ?? lastLegacyNote!.date,
                content: lastMeetingNote?.content ?? lastLegacyNote!.content,
                updatedAt: (lastMeetingNote?.updatedAt ?? lastLegacyNote!.updatedAt).toISOString()
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
      const schoolId = await loadTeacherSchoolId(user.id);
      const status = z
        .object({ status: z.enum(['active', 'archived', 'all']).default('active') })
        .parse(request.query).status;

      return { courses: await listCoursesForUser(user.id, schoolId, status) };
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
      const schoolId = await loadTeacherSchoolId(user.id);
      const body = CourseOrderUpdateRequestSchema.parse(request.body);
      const owned = await db
        .select({ id: teacherCourses.curriculumId })
        .from(teacherCourses)
        .innerJoin(courses, eq(teacherCourses.curriculumId, courses.id))
        .where(
          and(
            eq(teacherCourses.teacherId, user.id),
            eq(courses.schoolId, schoolId),
            inArray(teacherCourses.curriculumId, body.courseIds)
          )
        );
      if (owned.length !== body.courseIds.length) {
        (reply as any).code(404);
        return { error: 'One or more courses were not found', requestId: request.id };
      }

      await db.transaction(async (tx) => {
        await Promise.all(
          body.courseIds.map((courseId, sortIndex) =>
            tx
              .update(teacherCourses)
              .set({ sortIndex, updatedAt: new Date() })
              .where(
                and(
                  eq(teacherCourses.teacherId, user.id),
                  eq(teacherCourses.curriculumId, courseId)
                )
              )
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

      return { courses: await listCoursesForUser(user.id, schoolId, 'all') };
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
      if (body.sourceCourseId && !(await findOwnedCourse(user.id, body.sourceCourseId))) {
        (reply as any).code(404);
        return { error: 'Source course not found', requestId: request.id };
      }
      const [lastCourse] = await db
        .select({ sortIndex: courses.sortIndex })
        .from(courses)
        .where(eq(courses.teacherId, user.id))
        .orderBy(desc(courses.sortIndex))
        .limit(1);

      const [course] = await db.transaction(async (tx) => {
        const [created] = await tx
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
        if (!created) throw new Error('Failed to create course');
        await tx.insert(courseCollaborators).values({
          courseId: created.id,
          userId: user.id,
          role: 'owner',
          status: 'accepted',
          invitedByUserId: user.id,
          joinedAt: new Date()
        });
        await tx.insert(teacherCourses).values({
          teacherId: user.id,
          curriculumId: created.id,
          sourceCurriculumId: body.sourceCourseId ?? null,
          name: body.name,
          subject: body.subject,
          gradeLevel: body.gradeLevel,
          relationshipType: 'independent',
          sortIndex: (lastCourse?.sortIndex ?? -1) + 1
        });
        return [created];
      });

      if (!course) throw new Error('Failed to create course');

      await recordCourseActivity(
        course.id,
        user.id,
        'course_created',
        'course',
        course.id,
        'created the course',
        {
          dedupe: false
        }
      );

      if (body.sourceCourseId) {
        await copyCourseCurriculum(user.id, body.sourceCourseId, course.id);
        await recordCourseActivity(
          course.id,
          user.id,
          'curriculum_imported',
          'course',
          course.id,
          'imported curriculum from another course',
          { dedupe: false }
        );
      }

      const detail = await buildCourseDetail(user.id, course.id);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.post(
    '/v1/courses/:courseId/curriculum/copy',
    {
      schema: {
        params: CourseParamsSchema,
        body: CourseCurriculumCopyRequestSchema,
        response: { 200: CourseDetailResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const { courseId } = CourseParamsSchema.parse(request.params);
      const body = CourseCurriculumCopyRequestSchema.parse(request.body);
      const [target, source] = await Promise.all([
        findOwnedCourse(user.id, courseId),
        findOwnedCourse(user.id, body.sourceCourseId)
      ]);
      if (!target || !source) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }
      if (courseId === body.sourceCourseId) {
        (reply as any).code(400);
        return { error: 'Choose a different source course', requestId: request.id };
      }
      const [existingUnit] = await db
        .select({ id: units.id })
        .from(units)
        .where(eq(units.courseId, courseId))
        .limit(1);
      if (existingUnit) {
        (reply as any).code(409);
        return {
          error: 'Curriculum can only be copied into an empty course',
          requestId: request.id
        };
      }
      await copyCourseCurriculum(user.id, body.sourceCourseId, courseId);
      await recordCourseActivity(
        courseId,
        user.id,
        'curriculum_imported',
        'course',
        courseId,
        'imported curriculum from another course',
        { dedupe: false }
      );
      const detail = await buildCourseDetail(user.id, courseId);
      if (!detail) throw new Error('Failed to load copied curriculum');
      return detail;
    }
  );

  app.post(
    '/v1/courses/:courseId/duplicate',
    {
      schema: {
        params: CourseParamsSchema,
        body: CourseDuplicateRequestSchema,
        response: { 200: CourseDetailResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const { courseId } = CourseParamsSchema.parse(request.params);
      const body = CourseDuplicateRequestSchema.parse(request.body);
      const source = await findOwnedCourse(user.id, courseId);
      if (!source) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }
      const [lastCourse] = await db
        .select({ sortIndex: courses.sortIndex })
        .from(courses)
        .where(eq(courses.teacherId, user.id))
        .orderBy(desc(courses.sortIndex))
        .limit(1);
      const [created] = await db.transaction(async (tx) => {
        const [course] = await tx
          .insert(courses)
          .values({
            teacherId: user.id,
            schoolId: source.schoolId,
            name: body.name,
            subject: source.subject,
            gradeLevel: source.gradeLevel,
            sortIndex: (lastCourse?.sortIndex ?? -1) + 1
          })
          .returning({ id: courses.id });
        if (!course) throw new Error('Failed to duplicate course');
        await tx.insert(courseCollaborators).values({
          courseId: course.id,
          userId: user.id,
          role: 'owner',
          status: 'accepted',
          invitedByUserId: user.id,
          joinedAt: new Date()
        });
        await tx.insert(teacherCourses).values({
          teacherId: user.id,
          curriculumId: course.id,
          sourceCurriculumId: source.id,
          name: body.name,
          subject: source.subject,
          gradeLevel: source.gradeLevel,
          relationshipType: 'independent',
          sortIndex: (lastCourse?.sortIndex ?? -1) + 1
        });
        return [course];
      });
      if (!created) throw new Error('Failed to duplicate course');
      await copyCourseCurriculum(user.id, source.id, created.id);
      const detail = await buildCourseDetail(user.id, created.id);
      if (!detail) throw new Error('Failed to load duplicated course');
      return detail;
    }
  );

  app.patch('/v1/courses/:courseId/archive', async (request, reply) => {
    const principal = requirePrincipal(request, reply);
    if (!principal) return;
    const user = await ensureUserFromPrincipal(principal);
    const { courseId } = CourseParamsSchema.parse(request.params);
    if (!(await findOwnedCourse(user.id, courseId))) {
      (reply as any).code(404);
      return { error: 'Course not found', requestId: request.id };
    }
    const [course] = await db
      .update(teacherCourses)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(teacherCourses.curriculumId, courseId), eq(teacherCourses.teacherId, user.id)))
      .returning({ courseId: teacherCourses.curriculumId });
    if (!course) {
      (reply as any).code(404);
      return { error: 'Course not found', requestId: request.id };
    }
    return { archived: true };
  });

  app.patch('/v1/courses/:courseId/restore', async (request, reply) => {
    const principal = requirePrincipal(request, reply);
    if (!principal) return;
    const user = await ensureUserFromPrincipal(principal);
    const { courseId } = CourseParamsSchema.parse(request.params);
    if (!(await findOwnedCourse(user.id, courseId))) {
      (reply as any).code(404);
      return { error: 'Course not found', requestId: request.id };
    }
    const [course] = await db
      .update(teacherCourses)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(and(eq(teacherCourses.curriculumId, courseId), eq(teacherCourses.teacherId, user.id)))
      .returning({ courseId: teacherCourses.curriculumId });
    if (!course) {
      (reply as any).code(404);
      return { error: 'Course not found', requestId: request.id };
    }
    return { archived: false };
  });

  app.get(
    '/v1/course-invitations',
    { schema: { response: { 200: CourseInvitationsResponseSchema } } },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const rows = await db
        .select({
          courseId: courses.id,
          name: courses.name,
          subject: courses.subject,
          gradeLevel: courses.gradeLevel,
          sortIndex: courses.sortIndex,
          createdAt: courses.createdAt,
          updatedAt: courses.updatedAt,
          invitedByUserId: courseCollaborators.invitedByUserId
        })
        .from(courseCollaborators)
        .innerJoin(courses, eq(courseCollaborators.courseId, courses.id))
        .innerJoin(
          schoolMemberships,
          and(
            eq(schoolMemberships.userId, user.id),
            eq(schoolMemberships.schoolId, courses.schoolId),
            eq(schoolMemberships.status, 'active')
          )
        )
        .where(
          and(eq(courseCollaborators.userId, user.id), eq(courseCollaborators.status, 'invited'))
        )
        .orderBy(desc(courseCollaborators.createdAt));
      const inviterIds = rows
        .map((row) => row.invitedByUserId)
        .filter((id): id is string => id !== null);
      const inviters = inviterIds.length
        ? await db
            .select({ id: users.id, fullName: users.fullName, email: users.email })
            .from(users)
            .where(inArray(users.id, inviterIds))
        : [];
      const inviterById = new Map(inviters.map((inviter) => [inviter.id, inviter]));
      return CourseInvitationsResponseSchema.parse({
        invitations: rows.flatMap((row) => {
          const inviter = row.invitedByUserId ? inviterById.get(row.invitedByUserId) : null;
          if (!inviter) return [];
          return [
            {
              course: {
                id: row.courseId,
                curriculumId: row.courseId,
                curriculumName: row.name,
                relationshipType: 'shared',
                name: row.name,
                subject: row.subject,
                gradeLevel: row.gradeLevel,
                sortIndex: row.sortIndex,
                archivedAt: null,
                createdAt: row.createdAt.toISOString(),
                updatedAt: row.updatedAt.toISOString(),
                accessRole: 'editor',
                lifecycle: 'unlinked',
                linkedClassGroupCount: 0
              },
              invitedBy: { userId: inviter.id, fullName: inviter.fullName, email: inviter.email }
            }
          ];
        })
      });
    }
  );

  app.post('/v1/course-invitations/:courseId/accept', async (request, reply) => {
    const principal = requirePrincipal(request, reply);
    if (!principal) return;
    const user = await ensureUserFromPrincipal(principal);
    const { courseId } = CourseParamsSchema.parse(request.params);
    const body = CourseInvitationAcceptRequestSchema.parse(request.body);
    const [sourceCourse] = await db
      .select({
        id: courses.id,
        schoolId: courses.schoolId,
        name: courses.name,
        subject: courses.subject,
        gradeLevel: courses.gradeLevel,
        sortIndex: courses.sortIndex
      })
      .from(courses)
      .innerJoin(
        schoolMemberships,
        and(
          eq(schoolMemberships.userId, user.id),
          eq(schoolMemberships.schoolId, courses.schoolId),
          eq(schoolMemberships.status, 'active')
        )
      )
      .where(eq(courses.id, courseId))
      .limit(1);
    if (!sourceCourse) {
      (reply as any).code(404);
      return { error: 'Course invitation not found', requestId: request.id };
    }
    const [accepted] = await db
      .update(courseCollaborators)
      .set({ status: 'accepted', joinedAt: new Date(), archivedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(courseCollaborators.courseId, courseId),
          eq(courseCollaborators.userId, user.id),
          eq(courseCollaborators.status, 'invited')
        )
      )
      .returning({ courseId: courseCollaborators.courseId });
    if (!accepted) {
      (reply as any).code(404);
      return { error: 'Course invitation not found', requestId: request.id };
    }
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.recipientUserId, user.id),
          eq(notifications.courseId, courseId),
          eq(notifications.type, 'course_invitation'),
          isNull(notifications.readAt)
        )
      );
    let teacherCourseCurriculumId = courseId;
    if (body.mode === 'copy') {
      const [created] = await db.transaction(async (tx) => {
        const [curriculum] = await tx
          .insert(courses)
          .values({
            teacherId: user.id,
            schoolId: sourceCourse.schoolId,
            name: body.name,
            subject: sourceCourse.subject,
            gradeLevel: sourceCourse.gradeLevel,
            sortIndex: sourceCourse.sortIndex
          })
          .returning({ id: courses.id });
        if (!curriculum) throw new Error('Failed to create an independent curriculum copy');
        await tx.insert(courseCollaborators).values({
          courseId: curriculum.id,
          userId: user.id,
          role: 'owner',
          status: 'accepted',
          invitedByUserId: user.id,
          joinedAt: new Date()
        });
        await tx.insert(teacherCourses).values({
          teacherId: user.id,
          curriculumId: curriculum.id,
          sourceCurriculumId: courseId,
          name: body.name,
          subject: sourceCourse.subject,
          gradeLevel: sourceCourse.gradeLevel,
          relationshipType: 'independent',
          sortIndex: sourceCourse.sortIndex
        });
        return [curriculum];
      });
      if (!created) throw new Error('Failed to create an independent curriculum copy');
      await copyCourseCurriculum(user.id, courseId, created.id);
      // The copy is now self-contained. Remove the temporary source membership
      // so later shared edits cannot appear in this teacher's workspace.
      await db
        .delete(courseCollaborators)
        .where(
          and(eq(courseCollaborators.courseId, courseId), eq(courseCollaborators.userId, user.id))
        );
      teacherCourseCurriculumId = created.id;
    } else {
      await db
        .insert(teacherCourses)
        .values({
          teacherId: user.id,
          curriculumId: courseId,
          name: body.name,
          subject: sourceCourse.subject,
          gradeLevel: sourceCourse.gradeLevel,
          relationshipType: 'shared',
          sortIndex: sourceCourse.sortIndex
        })
        .onConflictDoUpdate({
          target: [teacherCourses.teacherId, teacherCourses.curriculumId],
          set: {
            name: body.name,
            relationshipType: 'shared',
            archivedAt: null,
            updatedAt: new Date()
          }
        });
    }
    await recordCourseActivity(
      courseId,
      user.id,
      'collaboration_joined',
      'course',
      courseId,
      'joined the course'
    );
    const detail = await buildCourseDetail(user.id, teacherCourseCurriculumId);
    if (!detail) throw new Error('Could not load accepted course');
    return detail;
  });

  app.delete('/v1/course-invitations/:courseId', async (request, reply) => {
    const principal = requirePrincipal(request, reply);
    if (!principal) return;
    const user = await ensureUserFromPrincipal(principal);
    const { courseId } = CourseParamsSchema.parse(request.params);
    const [declined] = await db
      .delete(courseCollaborators)
      .where(
        and(
          eq(courseCollaborators.courseId, courseId),
          eq(courseCollaborators.userId, user.id),
          eq(courseCollaborators.status, 'invited')
        )
      )
      .returning({ courseId: courseCollaborators.courseId });
    if (!declined) {
      (reply as any).code(404);
      return { error: 'Course invitation not found', requestId: request.id };
    }
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.recipientUserId, user.id),
          eq(notifications.courseId, courseId),
          eq(notifications.type, 'course_invitation'),
          isNull(notifications.readAt)
        )
      );
    return { deleted: true };
  });

  app.get(
    '/v1/courses/:courseId/collaborators',
    {
      schema: { params: CourseParamsSchema, response: { 200: CourseCollaboratorsResponseSchema } }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const { courseId } = CourseParamsSchema.parse(request.params);
      if (!(await findOwnedCourse(user.id, courseId))) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }
      return buildCourseCollaborators(courseId);
    }
  );

  app.post(
    '/v1/courses/:courseId/collaborators',
    {
      schema: {
        params: CourseParamsSchema,
        body: CourseCollaboratorInviteRequestSchema,
        response: { 200: CourseCollaboratorsResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const { courseId } = CourseParamsSchema.parse(request.params);
      const body = CourseCollaboratorInviteRequestSchema.parse(request.body);
      const ownedCourse = await findCourseOwnedBy(user.id, courseId);
      if (!ownedCourse) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }
      const recipients = await db
        .select({ id: users.id })
        .from(users)
        .innerJoin(
          schoolMemberships,
          and(
            eq(schoolMemberships.userId, users.id),
            eq(schoolMemberships.schoolId, ownedCourse.schoolId),
            eq(schoolMemberships.status, 'active')
          )
        )
        .where(sql`lower(${users.email}) = lower(${body.email})`)
        .limit(2);
      if (recipients.length === 0) {
        (reply as any).code(404);
        return {
          error: 'That teacher needs a TeacherOS account before you can invite them.',
          requestId: request.id
        };
      }
      if (recipients.length > 1) {
        (reply as any).code(409);
        return {
          error: 'That email matches multiple accounts. Use a unique account email.',
          requestId: request.id
        };
      }
      const recipient = recipients[0]!;
      if (recipient.id === user.id) {
        (reply as any).code(400);
        return { error: 'You already own this course.', requestId: request.id };
      }
      const [existingMembership] = await db
        .select({ status: courseCollaborators.status })
        .from(courseCollaborators)
        .where(
          and(
            eq(courseCollaborators.courseId, courseId),
            eq(courseCollaborators.userId, recipient.id)
          )
        )
        .limit(1);
      if (existingMembership) {
        (reply as any).code(409);
        return {
          error:
            existingMembership.status === 'accepted'
              ? 'That teacher already collaborates on this course.'
              : 'That teacher already has a pending invitation.',
          requestId: request.id
        };
      }
      await db.insert(courseCollaborators).values({
        courseId,
        userId: recipient.id,
        role: 'editor',
        status: 'invited',
        invitedByUserId: user.id
      });
      await recordCourseActivity(
        courseId,
        user.id,
        'collaborator_invited',
        'course',
        courseId,
        `invited ${body.email} to collaborate`,
        { dedupe: false }
      );
      await createNotification({
        recipientUserId: recipient.id,
        actorUserId: user.id,
        courseId,
        type: 'course_invitation',
        title: ownedCourse.name,
        message: 'invited you to collaborate',
        actionUrl: '/sharing'
      });
      return buildCourseCollaborators(courseId);
    }
  );

  app.delete('/v1/courses/:courseId/collaborators/:userId', async (request, reply) => {
    const principal = requirePrincipal(request, reply);
    if (!principal) return;
    const user = await ensureUserFromPrincipal(principal);
    const { courseId } = CourseParamsSchema.parse(request.params);
    const collaboratorId = z.object({ userId: UuidSchema }).parse(request.params).userId;
    if (!(await findCourseOwnedBy(user.id, courseId))) {
      (reply as any).code(404);
      return { error: 'Course not found', requestId: request.id };
    }
    const linked = await db
      .select({ id: sections.id })
      .from(sections)
      .where(and(eq(sections.courseId, courseId), eq(sections.teacherId, collaboratorId)))
      .limit(1);
    if (linked.length) {
      (reply as any).code(409);
      return {
        error: 'This collaborator must unlink their class groups before access can be removed.',
        requestId: request.id
      };
    }
    const [removed] = await db
      .delete(courseCollaborators)
      .where(
        and(
          eq(courseCollaborators.courseId, courseId),
          eq(courseCollaborators.userId, collaboratorId),
          eq(courseCollaborators.role, 'editor')
        )
      )
      .returning({ userId: courseCollaborators.userId });
    if (!removed) {
      (reply as any).code(404);
      return { error: 'Collaborator not found', requestId: request.id };
    }
    await recordCourseActivity(
      courseId,
      user.id,
      'collaborator_removed',
      'course',
      courseId,
      'removed a collaborator',
      { dedupe: false }
    );
    return { deleted: true };
  });

  app.delete('/v1/courses/:courseId/membership', async (request, reply) => {
    const principal = requirePrincipal(request, reply);
    if (!principal) return;
    const user = await ensureUserFromPrincipal(principal);
    const { courseId } = CourseParamsSchema.parse(request.params);
    const member = await findOwnedCourse(user.id, courseId);
    if (!member) {
      (reply as any).code(404);
      return { error: 'Course not found', requestId: request.id };
    }
    if (member.accessRole === 'owner') {
      (reply as any).code(400);
      return { error: 'Transfer ownership before leaving this course.', requestId: request.id };
    }
    const linked = await db
      .select({ id: sections.id })
      .from(sections)
      .where(and(eq(sections.courseId, courseId), eq(sections.teacherId, user.id)))
      .limit(1);
    if (linked.length) {
      (reply as any).code(409);
      return {
        error: 'Unlink your class groups before leaving this course.',
        requestId: request.id
      };
    }
    await recordCourseActivity(
      courseId,
      user.id,
      'collaboration_left',
      'course',
      courseId,
      'left the course',
      {
        dedupe: false
      }
    );
    await db
      .delete(courseCollaborators)
      .where(
        and(eq(courseCollaborators.courseId, courseId), eq(courseCollaborators.userId, user.id))
      );
    return { deleted: true };
  });

  app.patch(
    '/v1/courses/:courseId/ownership',
    { schema: { params: CourseParamsSchema, body: CourseOwnershipTransferRequestSchema } },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const { courseId } = CourseParamsSchema.parse(request.params);
      const body = CourseOwnershipTransferRequestSchema.parse(request.body);
      const ownedCourse = await findCourseOwnedBy(user.id, courseId);
      if (!ownedCourse) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }
      const nextOwners = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = lower(${body.email})`)
        .limit(2);
      if (nextOwners.length === 0) {
        (reply as any).code(404);
        return { error: 'Collaborator not found', requestId: request.id };
      }
      if (nextOwners.length > 1) {
        (reply as any).code(409);
        return {
          error: 'That email matches multiple accounts. Use a unique account email.',
          requestId: request.id
        };
      }
      const nextOwner = nextOwners[0]!;
      const [membership] = await db
        .select({ userId: courseCollaborators.userId })
        .from(courseCollaborators)
        .innerJoin(courses, eq(courseCollaborators.courseId, courses.id))
        .innerJoin(
          schoolMemberships,
          and(
            eq(schoolMemberships.userId, nextOwner.id),
            eq(schoolMemberships.schoolId, ownedCourse.schoolId),
            eq(schoolMemberships.status, 'active')
          )
        )
        .where(
          and(
            eq(courseCollaborators.courseId, courseId),
            eq(courses.schoolId, ownedCourse.schoolId),
            eq(courseCollaborators.userId, nextOwner.id),
            eq(courseCollaborators.status, 'accepted'),
            eq(courseCollaborators.role, 'editor')
          )
        )
        .limit(1);
      if (!membership) {
        (reply as any).code(400);
        return { error: 'Choose an accepted course collaborator.', requestId: request.id };
      }
      await db.transaction(async (tx) => {
        const now = new Date();
        const [updatedCourse] = await tx
          .update(courses)
          .set({ teacherId: nextOwner.id, updatedAt: now })
          .where(and(eq(courses.id, courseId), eq(courses.teacherId, user.id)))
          .returning({ id: courses.id });
        if (!updatedCourse) {
          const error = new Error('Course ownership changed. Reload and try again.') as Error & {
            statusCode?: number;
          };
          error.statusCode = 409;
          throw error;
        }
        const [updatedOwner] = await tx
          .update(courseCollaborators)
          .set({ role: 'editor', updatedAt: now })
          .where(
            and(
              eq(courseCollaborators.courseId, courseId),
              eq(courseCollaborators.userId, user.id),
              eq(courseCollaborators.status, 'accepted'),
              eq(courseCollaborators.role, 'owner')
            )
          )
          .returning({ userId: courseCollaborators.userId });
        if (!updatedOwner) {
          const error = new Error('Course ownership could not be transferred.') as Error & {
            statusCode?: number;
          };
          error.statusCode = 409;
          throw error;
        }
        const [promoted] = await tx
          .update(courseCollaborators)
          .set({ role: 'owner', updatedAt: now })
          .where(
            and(
              eq(courseCollaborators.courseId, courseId),
              eq(courseCollaborators.userId, nextOwner.id),
              eq(courseCollaborators.status, 'accepted'),
              eq(courseCollaborators.role, 'editor'),
              sql`exists (
                select 1
                from school_memberships active_membership
                where active_membership.user_id = ${nextOwner.id}
                  and active_membership.school_id = ${ownedCourse.schoolId}
                  and active_membership.status = 'active'
              )`
            )
          )
          .returning({ userId: courseCollaborators.userId });
        if (!promoted) {
          const error = new Error('The selected collaborator is no longer available.') as Error & {
            statusCode?: number;
          };
          error.statusCode = 409;
          throw error;
        }
      });
      await recordCourseActivity(
        courseId,
        user.id,
        'ownership_transferred',
        'course',
        courseId,
        `transferred ownership to ${body.email}`,
        { dedupe: false }
      );
      return buildCourseCollaborators(courseId);
    }
  );

  app.get(
    '/v1/courses/:courseId/activity',
    {
      schema: {
        params: CourseParamsSchema,
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
        response: { 200: CourseActivityResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const { courseId } = CourseParamsSchema.parse(request.params);
      const { limit } = z
        .object({ limit: z.coerce.number().int().min(1).max(100).default(20) })
        .parse(request.query);
      if (!(await findOwnedCourse(user.id, courseId))) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }
      return buildCourseActivity(courseId, limit);
    }
  );

  app.get(
    '/v1/courses/:courseId/pacing',
    {
      schema: { params: CourseParamsSchema, response: { 200: CoursePacingResponseSchema } }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const { courseId } = CourseParamsSchema.parse(request.params);
      const pacing = await buildCoursePacing(user.id, courseId);
      if (!pacing) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }
      return pacing;
    }
  );

  app.patch(
    '/v1/courses/:courseId/pacing-sharing',
    {
      schema: {
        params: CourseParamsSchema,
        body: CoursePacingSharingUpdateRequestSchema,
        response: { 200: CoursePacingResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const { courseId } = CourseParamsSchema.parse(request.params);
      const body = CoursePacingSharingUpdateRequestSchema.parse(request.body);
      if (!(await findOwnedCourse(user.id, courseId))) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }
      const [membership] = await db
        .update(courseCollaborators)
        .set({ shareProgress: body.enabled, updatedAt: new Date() })
        .where(
          and(
            eq(courseCollaborators.courseId, courseId),
            eq(courseCollaborators.userId, user.id),
            eq(courseCollaborators.status, 'accepted')
          )
        )
        .returning({ courseId: courseCollaborators.courseId });
      if (!membership) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }
      await recordCourseActivity(
        courseId,
        user.id,
        body.enabled ? 'pacing_sharing_enabled' : 'pacing_sharing_disabled',
        'course',
        courseId,
        body.enabled
          ? 'started sharing their class-group progress'
          : 'stopped sharing their class-group progress',
        { dedupe: false }
      );
      const pacing = await buildCoursePacing(user.id, courseId);
      if (!pacing) throw new Error('Failed to load course pacing');
      return pacing;
    }
  );

  app.get(
    '/v1/lessons/:lessonId/comments',
    {
      schema: { params: LessonParamsSchema, response: { 200: LessonCommentsResponseSchema } }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const { lessonId } = LessonParamsSchema.parse(request.params);
      const courseId = await findOwnedCourseIdForLesson(user.id, lessonId);
      if (!courseId) {
        (reply as any).code(404);
        return { error: 'Lesson not found', requestId: request.id };
      }
      return buildLessonComments(courseId, lessonId);
    }
  );

  app.post(
    '/v1/lessons/:lessonId/comments',
    {
      schema: {
        params: LessonParamsSchema,
        body: LessonCommentCreateRequestSchema,
        response: { 200: LessonCommentsResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const { lessonId } = LessonParamsSchema.parse(request.params);
      const body = LessonCommentCreateRequestSchema.parse(request.body);
      const courseId = await findOwnedCourseIdForLesson(user.id, lessonId);
      if (!courseId) {
        (reply as any).code(404);
        return { error: 'Lesson not found', requestId: request.id };
      }
      const [lesson] = await db
        .select({ title: lessons.title })
        .from(lessons)
        .where(eq(lessons.id, lessonId))
        .limit(1);
      if (!lesson) {
        (reply as any).code(404);
        return { error: 'Lesson not found', requestId: request.id };
      }
      await db
        .insert(lessonComments)
        .values({ courseId, lessonId, authorUserId: user.id, body: body.body });
      await recordCourseActivity(
        courseId,
        user.id,
        'lesson_comment_added',
        'lesson',
        lessonId,
        `commented on ${lesson.title}`,
        { dedupe: false }
      );
      return buildLessonComments(courseId, lessonId);
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

      const updates: Partial<typeof teacherCourses.$inferInsert> = {
        updatedAt: new Date()
      };
      if (body.name !== undefined) updates.name = body.name;
      if (body.subject !== undefined) updates.subject = body.subject;
      if (body.gradeLevel !== undefined) updates.gradeLevel = body.gradeLevel;
      if (body.sortIndex !== undefined) updates.sortIndex = body.sortIndex;

      if (!(await findOwnedCourse(user.id, params.courseId))) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }

      const [updated] = await db
        .update(teacherCourses)
        .set(updates)
        .where(
          and(
            eq(teacherCourses.curriculumId, params.courseId),
            eq(teacherCourses.teacherId, user.id)
          )
        )
        .returning({ id: teacherCourses.id });

      if (!updated) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }

      await recordCourseActivity(
        params.courseId,
        user.id,
        'course_updated',
        'course',
        params.courseId,
        body.sortIndex !== undefined && Object.keys(body).length === 1
          ? 'reordered the course'
          : 'edited course details'
      );

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
        body: CourseDeleteRequestSchema,
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
      CourseDeleteRequestSchema.parse(request.body);

      // Deleting a shared curriculum also deletes every linked class group,
      // including other teachers' local history. Only its owner may do that.
      if (!(await findCourseOwnedBy(user.id, params.courseId))) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }

      const [deleted] = await db
        .delete(courses)
        .where(eq(courses.id, params.courseId))
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
        plannedMeetingCount: body.plannedMeetingCount ?? null,
        googleSlidesUrl: body.googleSlidesUrl ?? null,
        googleSlidesStartSlide: body.googleSlidesStartSlide ?? 1
      });

      await recordCourseActivity(
        params.courseId,
        user.id,
        'unit_created',
        'unit',
        null,
        `added Unit: ${body.title}`,
        { dedupe: false }
      );

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
      if (body.googleSlidesUrl !== undefined) updates.googleSlidesUrl = body.googleSlidesUrl;
      if (body.googleSlidesStartSlide !== undefined)
        updates.googleSlidesStartSlide = body.googleSlidesStartSlide;

      await db.transaction(async (tx) => {
        if (body.googleSlidesUrl !== undefined) {
          const [existing] = await tx
            .select({ googleSlidesUrl: units.googleSlidesUrl })
            .from(units)
            .where(eq(units.id, params.unitId))
            .limit(1);
          // A different deck must not inherit a class group's position from
          // the old one. Removing and re-adding the same URL is also a reset.
          if (existing?.googleSlidesUrl !== body.googleSlidesUrl) {
            await tx
              .delete(sectionUnitSlideState)
              .where(eq(sectionUnitSlideState.unitId, params.unitId));
          }
        }
        await tx.update(units).set(updates).where(eq(units.id, params.unitId));
      });

      await recordCourseActivity(
        ownedCourseId,
        user.id,
        body.orderIndex !== undefined && Object.keys(body).length === 1
          ? 'unit_reordered'
          : 'unit_updated',
        'unit',
        params.unitId,
        body.orderIndex !== undefined && Object.keys(body).length === 1
          ? 'reordered a unit'
          : `edited Unit${body.title ? `: ${body.title}` : ''}`
      );

      const detail = await buildCourseDetail(user.id, ownedCourseId);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.get(
    '/v1/sections/:sectionId/units/:unitId/slides',
    {
      schema: {
        params: SectionUnitParamsSchema,
        response: { 200: UnitSlidesProgressResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = SectionUnitParamsSchema.parse(request.params);
      const unit = await findOwnedUnitInSectionCourse(user.id, params.sectionId, params.unitId);
      if (!unit?.googleSlidesUrl) {
        (reply as any).code(404);
        return { error: 'Unit slides not found', requestId: request.id };
      }
      const [state] = await db
        .select({
          currentSlide: sectionUnitSlideState.currentSlide,
          updatedAt: sectionUnitSlideState.updatedAt
        })
        .from(sectionUnitSlideState)
        .where(
          and(
            eq(sectionUnitSlideState.sectionId, params.sectionId),
            eq(sectionUnitSlideState.unitId, params.unitId)
          )
        )
        .limit(1);
      return UnitSlidesProgressResponseSchema.parse({
        currentSlide: state?.currentSlide ?? unit.googleSlidesStartSlide,
        updatedAt: state?.updatedAt.toISOString() ?? null
      });
    }
  );

  app.patch(
    '/v1/sections/:sectionId/units/:unitId/slides',
    {
      schema: {
        params: SectionUnitParamsSchema,
        body: UnitSlidesProgressUpsertRequestSchema,
        response: { 200: UnitSlidesProgressResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = SectionUnitParamsSchema.parse(request.params);
      const body = UnitSlidesProgressUpsertRequestSchema.parse(request.body);
      const unit = await findOwnedUnitInSectionCourse(user.id, params.sectionId, params.unitId);
      if (!unit?.googleSlidesUrl) {
        (reply as any).code(404);
        return { error: 'Unit slides not found', requestId: request.id };
      }
      const [state] = await db
        .insert(sectionUnitSlideState)
        .values({
          sectionId: params.sectionId,
          unitId: params.unitId,
          currentSlide: body.currentSlide
        })
        .onConflictDoUpdate({
          target: [sectionUnitSlideState.sectionId, sectionUnitSlideState.unitId],
          set: { currentSlide: body.currentSlide, updatedAt: new Date() }
        })
        .returning({
          currentSlide: sectionUnitSlideState.currentSlide,
          updatedAt: sectionUnitSlideState.updatedAt
        });
      if (!state) throw new Error('Could not save slide position');
      return UnitSlidesProgressResponseSchema.parse({
        currentSlide: state.currentSlide,
        updatedAt: state.updatedAt.toISOString()
      });
    }
  );

  app.get(
    '/v1/sections/:sectionId/lessons/:lessonId/slides',
    {
      schema: {
        params: SectionLessonParamsSchema,
        response: { 200: LessonSlidesProgressResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = SectionLessonParamsSchema.parse(request.params);
      const lesson = await findOwnedLessonInSectionCourse(
        user.id,
        params.sectionId,
        params.lessonId
      );
      if (!lesson?.googleSlidesUrl) {
        (reply as any).code(404);
        return { error: 'Lesson slides not found', requestId: request.id };
      }
      const [state] = await db
        .select({
          currentSlide: sectionLessonSlideState.currentSlide,
          updatedAt: sectionLessonSlideState.updatedAt
        })
        .from(sectionLessonSlideState)
        .where(
          and(
            eq(sectionLessonSlideState.sectionId, params.sectionId),
            eq(sectionLessonSlideState.lessonId, params.lessonId)
          )
        )
        .limit(1);
      return LessonSlidesProgressResponseSchema.parse({
        currentSlide: state?.currentSlide ?? lesson.googleSlidesStartSlide,
        updatedAt: state?.updatedAt.toISOString() ?? null
      });
    }
  );

  app.patch(
    '/v1/sections/:sectionId/lessons/:lessonId/slides',
    {
      schema: {
        params: SectionLessonParamsSchema,
        body: LessonSlidesProgressUpsertRequestSchema,
        response: { 200: LessonSlidesProgressResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = SectionLessonParamsSchema.parse(request.params);
      const body = LessonSlidesProgressUpsertRequestSchema.parse(request.body);
      const lesson = await findOwnedLessonInSectionCourse(
        user.id,
        params.sectionId,
        params.lessonId
      );
      if (!lesson?.googleSlidesUrl) {
        (reply as any).code(404);
        return { error: 'Lesson slides not found', requestId: request.id };
      }
      const [state] = await db
        .insert(sectionLessonSlideState)
        .values({
          sectionId: params.sectionId,
          lessonId: params.lessonId,
          currentSlide: body.currentSlide
        })
        .onConflictDoUpdate({
          target: [sectionLessonSlideState.sectionId, sectionLessonSlideState.lessonId],
          set: { currentSlide: body.currentSlide, updatedAt: new Date() }
        })
        .returning({
          currentSlide: sectionLessonSlideState.currentSlide,
          updatedAt: sectionLessonSlideState.updatedAt
        });
      if (!state) throw new Error('Could not save slide position');
      return LessonSlidesProgressResponseSchema.parse({
        currentSlide: state.currentSlide,
        updatedAt: state.updatedAt.toISOString()
      });
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
      await recordCourseActivity(
        courseId,
        user.id,
        'unit_deleted',
        'unit',
        params.unitId,
        'deleted a unit',
        {
          dedupe: false
        }
      );
      return { deleted: true };
    }
  );

  app.post(
    '/v1/units/:unitId/duplicate',
    {
      schema: {
        params: UnitParamsSchema,
        response: { 200: CourseDetailResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const { unitId } = UnitParamsSchema.parse(request.params);
      const courseId = await findOwnedCourseIdForUnit(user.id, unitId);
      const detail = courseId ? await buildCourseDetail(user.id, courseId) : null;
      const source = detail?.course.units.find((unit) => unit.id === unitId);
      if (!courseId || !detail || !source) {
        (reply as any).code(404);
        return { error: 'Unit not found', requestId: request.id };
      }
      const orderIndex = nextOrderIndex(detail.course.units);
      const newStart = Math.max(
        0,
        ...detail.course.units.map(
          (unit) => (unit.plannedStartMeeting ?? 0) + (unit.plannedMeetingCount ?? 1)
        )
      );
      await db.transaction(async (tx) => {
        const [copy] = await tx
          .insert(units)
          .values({
            courseId,
            title: `${source.title} copy`,
            description: source.description,
            orderIndex,
            plannedStartMeeting: newStart,
            plannedMeetingCount: source.plannedMeetingCount,
            googleSlidesUrl: source.googleSlidesUrl,
            googleSlidesStartSlide: source.googleSlidesStartSlide
          })
          .returning({ id: units.id });
        if (!copy) throw new Error('Failed to duplicate unit');
        for (const lesson of source.lessons) {
          const [lessonCopy] = await tx
            .insert(lessons)
            .values({
              unitId: copy.id,
              title: lesson.title,
              description: lesson.description,
              lessonPlan: lesson.lessonPlan,
              googleSlidesUrl: lesson.googleSlidesUrl,
              googleSlidesStartSlide: lesson.googleSlidesStartSlide,
              estimatedDurationMinutes: lesson.estimatedDurationMinutes,
              orderIndex: lesson.orderIndex,
              plannedStartMeeting:
                lesson.plannedStartMeeting === null
                  ? null
                  : newStart +
                    Math.max(0, lesson.plannedStartMeeting - (source.plannedStartMeeting ?? 0)),
              plannedMeetingCount: lesson.plannedMeetingCount
            })
            .returning({ id: lessons.id });
          if (!lessonCopy) throw new Error('Failed to duplicate lesson');
          if (lesson.segments.length) {
            await tx.insert(lessonSegments).values(
              lesson.segments.map((step) => ({
                lessonId: lessonCopy.id,
                title: step.title,
                description: step.description,
                durationMinutes: step.durationMinutes,
                stepType: step.stepType,
                orderIndex: step.orderIndex
              }))
            );
          }
        }
      });
      const updated = await buildCourseDetail(user.id, courseId);
      if (!updated) throw new Error('Failed to load duplicated unit');
      return updated;
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
        lessonPlan: body.lessonPlan ?? {
          objective: null,
          teacherNotes: null,
          studentDirections: null,
          materials: null,
          links: []
        },
        googleSlidesUrl: body.googleSlidesUrl ?? null,
        googleSlidesStartSlide: body.googleSlidesStartSlide ?? 1,
        estimatedDurationMinutes: body.estimatedDurationMinutes,
        orderIndex: body.orderIndex ?? (latestLesson?.orderIndex ?? -1) + 1,
        plannedStartMeeting: body.plannedStartMeeting ?? null,
        plannedMeetingCount: body.plannedMeetingCount ?? null
      });

      await recordCourseActivity(
        courseId,
        user.id,
        'lesson_created',
        'lesson',
        null,
        `added Lesson: ${body.title}`,
        { dedupe: false }
      );

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
      if (body.lessonPlan !== undefined) updates.lessonPlan = body.lessonPlan;
      if (body.googleSlidesUrl !== undefined) updates.googleSlidesUrl = body.googleSlidesUrl;
      if (body.googleSlidesStartSlide !== undefined)
        updates.googleSlidesStartSlide = body.googleSlidesStartSlide;
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

      await db.transaction(async (tx) => {
        if (body.googleSlidesUrl !== undefined) {
          const [existing] = await tx
            .select({ googleSlidesUrl: lessons.googleSlidesUrl })
            .from(lessons)
            .where(eq(lessons.id, params.lessonId))
            .limit(1);
          if (existing?.googleSlidesUrl !== body.googleSlidesUrl) {
            await tx
              .delete(sectionLessonSlideState)
              .where(eq(sectionLessonSlideState.lessonId, params.lessonId));
          }
        }
        await tx.update(lessons).set(updates).where(eq(lessons.id, params.lessonId));
      });

      await recordCourseActivity(
        ownedCourseId,
        user.id,
        body.orderIndex !== undefined && Object.keys(body).length === 1
          ? 'lesson_reordered'
          : 'lesson_updated',
        'lesson',
        params.lessonId,
        body.orderIndex !== undefined && Object.keys(body).length === 1
          ? 'reordered a lesson'
          : `edited Lesson${body.title ? `: ${body.title}` : ''}`
      );

      const detail = await buildCourseDetail(user.id, ownedCourseId);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.post(
    '/v1/lessons/:lessonId/duplicate',
    {
      schema: {
        params: LessonParamsSchema,
        response: { 200: CourseDetailResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const { lessonId } = LessonParamsSchema.parse(request.params);
      const courseId = await findOwnedCourseIdForLesson(user.id, lessonId);
      const detail = courseId ? await buildCourseDetail(user.id, courseId) : null;
      const unit = detail?.course.units.find((item) =>
        item.lessons.some((lesson) => lesson.id === lessonId)
      );
      const source = unit?.lessons.find((lesson) => lesson.id === lessonId);
      if (!courseId || !detail || !unit || !source) {
        (reply as any).code(404);
        return { error: 'Lesson not found', requestId: request.id };
      }
      await db.transaction(async (tx) => {
        const [copy] = await tx
          .insert(lessons)
          .values({
            unitId: unit.id,
            title: `${source.title} copy`,
            description: source.description,
            lessonPlan: source.lessonPlan,
            googleSlidesUrl: source.googleSlidesUrl,
            googleSlidesStartSlide: source.googleSlidesStartSlide,
            estimatedDurationMinutes: source.estimatedDurationMinutes,
            orderIndex: nextOrderIndex(unit.lessons),
            plannedStartMeeting:
              source.plannedStartMeeting === null
                ? null
                : source.plannedStartMeeting + (source.plannedMeetingCount ?? 1),
            plannedMeetingCount: source.plannedMeetingCount
          })
          .returning({ id: lessons.id });
        if (!copy) throw new Error('Failed to duplicate lesson');
        if (source.segments.length) {
          await tx.insert(lessonSegments).values(
            source.segments.map((step) => ({
              lessonId: copy.id,
              title: step.title,
              description: step.description,
              durationMinutes: step.durationMinutes,
              stepType: step.stepType,
              orderIndex: step.orderIndex
            }))
          );
        }
      });
      const updated = await buildCourseDetail(user.id, courseId);
      if (!updated) throw new Error('Failed to load duplicated lesson');
      return updated;
    }
  );

  app.get(
    '/v1/lessons/:lessonId/workspace',
    { schema: { params: LessonParamsSchema, response: { 200: LessonWorkspaceResponseSchema } } },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const workspace = await buildLessonWorkspace(
        user.id,
        LessonParamsSchema.parse(request.params).lessonId
      );
      if (!workspace) {
        (reply as any).code(404);
        return { error: 'Lesson not found', requestId: request.id };
      }
      return workspace;
    }
  );

  app.patch(
    '/v1/lessons/:lessonId/share',
    {
      schema: {
        params: LessonParamsSchema,
        body: LessonShareUpdateRequestSchema,
        response: { 200: LessonShareResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const lessonId = LessonParamsSchema.parse(request.params).lessonId;
      const body = LessonShareUpdateRequestSchema.parse(request.body);
      if (!(await findOwnedCourseIdForLesson(user.id, lessonId))) {
        (reply as any).code(404);
        return { error: 'Lesson not found', requestId: request.id };
      }
      const [existing] = await db
        .select()
        .from(lessonShares)
        .where(eq(lessonShares.lessonId, lessonId))
        .limit(1);
      if (existing)
        await db
          .update(lessonShares)
          .set({ enabled: body.enabled, updatedAt: new Date() })
          .where(eq(lessonShares.lessonId, lessonId));
      else await db.insert(lessonShares).values({ lessonId, enabled: body.enabled });
      const [share] = await db
        .select()
        .from(lessonShares)
        .where(eq(lessonShares.lessonId, lessonId))
        .limit(1);
      return LessonShareResponseSchema.parse({
        enabled: share?.enabled ?? false,
        token: share?.publicToken ?? null
      });
    }
  );

  app.get(
    '/v1/courses/:courseId/share',
    {
      schema: {
        params: CourseParamsSchema,
        response: { 200: CourseShareResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const { courseId } = CourseParamsSchema.parse(request.params);
      if (!(await findOwnedCourse(user.id, courseId))) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }
      const [share] = await db
        .select()
        .from(courseShares)
        .where(eq(courseShares.courseId, courseId))
        .limit(1);
      return CourseShareResponseSchema.parse({
        enabled: share?.enabled ?? false,
        schoolVisible: share?.schoolVisible ?? false,
        token: share?.publicToken ?? null
      });
    }
  );

  app.patch(
    '/v1/courses/:courseId/share',
    {
      schema: {
        params: CourseParamsSchema,
        body: CourseShareUpdateRequestSchema,
        response: { 200: CourseShareResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const { courseId } = CourseParamsSchema.parse(request.params);
      const body = CourseShareUpdateRequestSchema.parse(request.body);
      if (!(await findCourseOwnedBy(user.id, courseId))) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }
      const [existing] = await db
        .select()
        .from(courseShares)
        .where(eq(courseShares.courseId, courseId))
        .limit(1);
      const enabled =
        body.schoolVisible === true ? true : (body.enabled ?? existing?.enabled ?? false);
      const schoolVisible = enabled
        ? (body.schoolVisible ?? existing?.schoolVisible ?? false)
        : false;
      if (existing) {
        await db
          .update(courseShares)
          .set({ enabled, schoolVisible, updatedAt: new Date() })
          .where(eq(courseShares.courseId, courseId));
      } else {
        await db.insert(courseShares).values({ courseId, enabled, schoolVisible });
      }
      const [share] = await db
        .select()
        .from(courseShares)
        .where(eq(courseShares.courseId, courseId))
        .limit(1);
      return CourseShareResponseSchema.parse({
        enabled: share?.enabled ?? false,
        schoolVisible: share?.schoolVisible ?? false,
        token: share?.publicToken ?? null
      });
    }
  );

  app.get(
    '/v1/public/curriculum/:token',
    {
      schema: {
        params: z.object({ token: z.string().uuid() }),
        response: { 200: PublicCurriculumResponseSchema }
      }
    },
    async (request, reply) => {
      const token = z.object({ token: z.string().uuid() }).parse(request.params).token;
      const [shared] = await db
        .select({ courseId: courses.id, teacherId: courses.teacherId })
        .from(courseShares)
        .innerJoin(courses, eq(courseShares.courseId, courses.id))
        .where(and(eq(courseShares.publicToken, token), eq(courseShares.enabled, true)))
        .limit(1);
      if (!shared) {
        (reply as any).code(404);
        return { error: 'Curriculum not found', requestId: request.id };
      }
      const detail = await buildCourseDetail(shared.teacherId, shared.courseId);
      if (!detail) {
        (reply as any).code(404);
        return { error: 'Curriculum not found', requestId: request.id };
      }
      reply.header('Cache-Control', 'no-store');
      return PublicCurriculumResponseSchema.parse({
        course: {
          name: detail.course.name,
          subject: detail.course.subject,
          gradeLevel: detail.course.gradeLevel,
          units: detail.course.units.map((unit) => ({
            title: unit.title,
            description: unit.description,
            unitSlides: unit.googleSlidesUrl
              ? { url: unit.googleSlidesUrl, startSlide: unit.googleSlidesStartSlide }
              : null,
            lessons: unit.lessons.map((lesson) => ({
              title: lesson.title,
              description: lesson.description,
              objective: lesson.lessonPlan.objective,
              materials: lesson.lessonPlan.materials,
              studentDirections: lesson.lessonPlan.studentDirections,
              lessonSlides: lesson.googleSlidesUrl
                ? { url: lesson.googleSlidesUrl, startSlide: lesson.googleSlidesStartSlide }
                : null,
              estimatedDurationMinutes: lesson.estimatedDurationMinutes,
              steps: lesson.segments.map((step) => ({
                title: step.title,
                description: step.description,
                durationMinutes: step.durationMinutes,
                stepType: step.stepType ?? null
              }))
            }))
          }))
        }
      });
    }
  );

  app.post(
    '/v1/public/curriculum/:token/import',
    {
      schema: {
        params: z.object({ token: z.string().uuid() }),
        body: PublicCurriculumImportRequestSchema,
        response: { 200: CourseDetailResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const token = z.object({ token: z.string().uuid() }).parse(request.params).token;
      const body = PublicCurriculumImportRequestSchema.parse(request.body);
      const [shared] = await db
        .select({
          courseId: courses.id,
          teacherId: courses.teacherId,
          name: courses.name,
          subject: courses.subject,
          gradeLevel: courses.gradeLevel
        })
        .from(courseShares)
        .innerJoin(courses, eq(courseShares.courseId, courses.id))
        .where(and(eq(courseShares.publicToken, token), eq(courseShares.enabled, true)))
        .limit(1);
      if (!shared) {
        (reply as any).code(404);
        return { error: 'Curriculum not found', requestId: request.id };
      }

      let targetCourseId: string;
      if (body.mode === 'copy_into') {
        targetCourseId = body.targetCourseId!;
        const target = await findCourseOwnedBy(user.id, targetCourseId);
        if (!target) {
          (reply as any).code(404);
          return { error: 'Choose one of your own courses.', requestId: request.id };
        }
        const [existingUnit] = await db
          .select({ id: units.id })
          .from(units)
          .where(eq(units.courseId, targetCourseId))
          .limit(1);
        if (existingUnit) {
          (reply as any).code(409);
          return {
            error: 'Curriculum can only be copied into an empty course.',
            requestId: request.id
          };
        }
      } else {
        const schoolId = await loadTeacherSchoolId(user.id);
        const [lastCourse] = await db
          .select({ sortIndex: teacherCourses.sortIndex })
          .from(teacherCourses)
          .where(eq(teacherCourses.teacherId, user.id))
          .orderBy(desc(teacherCourses.sortIndex))
          .limit(1);
        const sortIndex = (lastCourse?.sortIndex ?? -1) + 1;
        const [created] = await db.transaction(async (tx) => {
          const [course] = await tx
            .insert(courses)
            .values({
              teacherId: user.id,
              schoolId,
              name: body.name!,
              subject: shared.subject,
              gradeLevel: shared.gradeLevel,
              sortIndex
            })
            .returning({ id: courses.id });
          if (!course) throw new Error('Could not create the curriculum copy');
          await tx.insert(courseCollaborators).values({
            courseId: course.id,
            userId: user.id,
            role: 'owner',
            status: 'accepted',
            invitedByUserId: user.id,
            joinedAt: new Date()
          });
          await tx.insert(teacherCourses).values({
            teacherId: user.id,
            curriculumId: course.id,
            sourceCurriculumId: shared.courseId,
            name: body.name!,
            subject: shared.subject,
            gradeLevel: shared.gradeLevel,
            relationshipType: 'independent',
            sortIndex
          });
          return [course];
        });
        if (!created) throw new Error('Could not create the curriculum copy');
        targetCourseId = created.id;
      }

      const copied = await copyCourseCurriculum(
        shared.teacherId,
        shared.courseId,
        targetCourseId,
        'public'
      );
      if (!copied) throw new Error('Could not copy the shared curriculum');
      await recordCourseActivity(
        targetCourseId,
        user.id,
        'curriculum_imported',
        'course',
        targetCourseId,
        `imported curriculum from ${shared.name}`,
        { dedupe: false, metadata: { sourceCourseId: shared.courseId } }
      );
      await createNotification({
        recipientUserId: shared.teacherId,
        actorUserId: user.id,
        courseId: shared.courseId,
        type: 'curriculum_copied',
        title: shared.name,
        message: 'added a copy from your shared link',
        actionUrl: `/sharing?course=${shared.courseId}`
      });
      const detail = await buildCourseDetail(user.id, targetCourseId);
      if (!detail) throw new Error('Could not load the curriculum copy');
      return detail;
    }
  );

  app.get(
    '/v1/public/lessons/:token',
    {
      schema: {
        params: z.object({ token: z.string().uuid() }),
        response: { 200: PublicLessonResponseSchema }
      }
    },
    async (request, reply) => {
      const token = z.object({ token: z.string().uuid() }).parse(request.params).token;
      const [row] = await db
        .select({
          courseName: courses.name,
          unitTitle: units.title,
          googleSlidesUrl: units.googleSlidesUrl,
          googleSlidesStartSlide: units.googleSlidesStartSlide,
          lessonId: lessons.id,
          title: lessons.title,
          description: lessons.description,
          lessonPlan: lessons.lessonPlan,
          lessonGoogleSlidesUrl: lessons.googleSlidesUrl,
          lessonGoogleSlidesStartSlide: lessons.googleSlidesStartSlide,
          orderIndex: lessons.orderIndex,
          estimatedDurationMinutes: lessons.estimatedDurationMinutes,
          plannedStartMeeting: lessons.plannedStartMeeting,
          plannedMeetingCount: lessons.plannedMeetingCount
        })
        .from(lessonShares)
        .innerJoin(lessons, eq(lessonShares.lessonId, lessons.id))
        .innerJoin(units, eq(lessons.unitId, units.id))
        .innerJoin(courses, eq(units.courseId, courses.id))
        .where(and(eq(lessonShares.publicToken, token), eq(lessonShares.enabled, true)))
        .limit(1);
      if (!row) {
        (reply as any).code(404);
        return { error: 'Lesson not found', requestId: request.id };
      }
      const segments = await db
        .select({
          id: lessonSegments.id,
          title: lessonSegments.title,
          description: lessonSegments.description,
          durationMinutes: lessonSegments.durationMinutes,
          stepType: lessonSegments.stepType,
          orderIndex: lessonSegments.orderIndex
        })
        .from(lessonSegments)
        .where(eq(lessonSegments.lessonId, row.lessonId))
        .orderBy(asc(lessonSegments.orderIndex), asc(lessonSegments.createdAt));
      reply.header('Cache-Control', 'no-store');
      return PublicLessonResponseSchema.parse({
        courseName: row.courseName,
        unitTitle: row.unitTitle,
        unitSlides: row.googleSlidesUrl
          ? { url: row.googleSlidesUrl, startSlide: row.googleSlidesStartSlide }
          : null,
        lessonSlides: row.lessonGoogleSlidesUrl
          ? { url: row.lessonGoogleSlidesUrl, startSlide: row.lessonGoogleSlidesStartSlide }
          : null,
        lesson: {
          title: row.title,
          description: row.description,
          objective: row.lessonPlan.objective,
          materials: row.lessonPlan.materials,
          links: row.lessonPlan.links,
          estimatedDurationMinutes: row.estimatedDurationMinutes,
          steps: segments.map((segment) => ({
            title: segment.title,
            description: segment.description,
            durationMinutes: segment.durationMinutes,
            stepType: segment.stepType
          }))
        }
      });
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
      await recordCourseActivity(
        courseId,
        user.id,
        'lesson_deleted',
        'lesson',
        params.lessonId,
        'deleted a lesson',
        {
          dedupe: false
        }
      );
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
        stepType: body.stepType ?? null,
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
      if (body.stepType !== undefined) updates.stepType = body.stepType;
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

      const fileDataUrl = scheduleImportFileDataUrl(body);
      const response = await runStructuredPrompt<z.infer<typeof InternalParseScheduleSchema>>({
        apiKey: app.config.OPENAI_API_KEY,
        model: app.config.OPENAI_MODEL_PARSE_SCHEDULE,
        reasoningEffort: app.config.OPENAI_REASONING_EFFORT_PARSE_SCHEDULE,
        schemaName: 'schedule_import',
        schema: InternalParseScheduleSchema,
        systemPrompt: scheduleImportSystemPrompt,
        userPrompt: scheduleImportUserPrompt(body),
        fileDataUrl,
        fileName: body.fileName,
        maxAttempts: 1
      });

      // Pasted text already gives the model an explicit hierarchy. Running it
      // through an image-audit prompt can introduce records that are not in the
      // source. Reserve the second pass for visual schedules, where it catches
      // row-boundary and spanning-cell mistakes.
      if (!fileDataUrl) return ParseScheduleResponseSchema.parse(response);

      const auditedResponse = await runStructuredPrompt<
        z.infer<typeof InternalParseScheduleSchema>
      >({
        apiKey: app.config.OPENAI_API_KEY,
        model: app.config.OPENAI_MODEL_PARSE_SCHEDULE,
        reasoningEffort: app.config.OPENAI_REASONING_EFFORT_PARSE_SCHEDULE,
        schemaName: 'schedule_import_audit',
        schema: InternalParseScheduleSchema,
        systemPrompt: scheduleImportSystemPrompt,
        userPrompt: scheduleImportAuditPrompt(body, response),
        fileDataUrl,
        fileName: body.fileName,
        maxAttempts: 1
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
      const unresolvedMeeting = body.classes.find(
        (parsedClass) => !parsedClass.time || !parsedClass.endTime
      );
      if (unresolvedMeeting) {
        (reply as any).code(400);
        return {
          error: `Add both a start and end time for ${unresolvedMeeting.name}, ${unresolvedMeeting.period} before applying the schedule`,
          requestId: request.id
        };
      }

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
          .select({ id: sections.id, courseId: sections.courseId, sectionName: sections.name })
          .from(sections)
          .innerJoin(courses, eq(sections.courseId, courses.id))
          .where(eq(sections.teacherId, user.id));
        const sectionsByKey = new Map(
          existingSections.map((section) => [
            `${section.courseId}|${importNameKey(section.sectionName)}`,
            section.id
          ])
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
            await tx.insert(courseCollaborators).values({
              courseId,
              userId: user.id,
              role: 'owner',
              status: 'accepted',
              invitedByUserId: user.id,
              joinedAt: new Date()
            });
            coursesByName.set(courseKey, courseId);
          }

          const sectionKey = `${courseId}|${importNameKey(firstClass.period)}`;
          const meetings = classGroup.classes
            .flatMap((parsedClass) =>
              parsedClass.days.map((day) => ({
                day,
                time: parsedClass.time,
                endTime: parsedClass.endTime,
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
          const existingSectionId = sectionsByKey.get(sectionKey);
          if (existingSectionId) {
            // Re-applying a teacher-reviewed import updates the recurring
            // meeting pattern in place. The section identifier (and therefore
            // its progress/history) remains stable.
            if (meetings.length) {
              await tx
                .delete(sectionMeetings)
                .where(eq(sectionMeetings.sectionId, existingSectionId));
              await tx.insert(sectionMeetings).values(
                meetings.map((meeting) => ({
                  sectionId: existingSectionId,
                  day: meeting.day,
                  meetingTime: meeting.time,
                  endTime: meeting.endTime,
                  room: meeting.room
                }))
              );
            }
            continue;
          }
          const [section] = await tx
            .insert(sections)
            .values({
              courseId,
              teacherId: user.id,
              name: firstClass.period,
              originalScheduleLabel: `${firstClass.name} · ${firstClass.period}`
            })
            .returning({ id: sections.id });
          if (!section) throw new Error('Failed to create class group');
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
          sectionsByKey.set(sectionKey, section.id);
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
      if (!(await assertSchoolCalendarWriteAccess(user.id, schoolId, request, reply))) return;
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
      if (!(await assertSchoolCalendarWriteAccess(user.id, schoolId, request, reply))) return;
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
    '/v1/class-meetings/upsert',
    {
      schema: {
        body: ClassMeetingUpsertRequestSchema,
        response: { 200: ClassMeetingResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const body = ClassMeetingUpsertRequestSchema.parse(request.body);
      if (!(await findOwnedLessonInSectionCourse(user.id, body.sectionId, body.lessonId))) {
        (reply as any).code(404);
        return { error: 'Section or lesson not found', requestId: request.id };
      }
      const requestedOccurrenceKey =
        body.origin === 'manual'
          ? `manual:${body.lessonId}`
          : meetingOccurrenceKey(body.scheduledStartTime);
      try {
        const response = await db.transaction(async (tx) => {
          // State and cumulative history are shared by all occurrences of one
          // section/lesson. Serialize that narrow aggregate, while retaining
          // per-occurrence optimistic revisions for two tabs on the same row.
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext(${`${body.sectionId}:${body.lessonId}`}))`
          );
          const steps = await tx
            .select({
              id: lessonSegments.id,
              title: lessonSegments.title,
              orderIndex: lessonSegments.orderIndex
            })
            .from(lessonSegments)
            .where(eq(lessonSegments.lessonId, body.lessonId))
            .orderBy(asc(lessonSegments.orderIndex), asc(lessonSegments.createdAt));
          const validIds = new Set(steps.map((step) => step.id));
          const completedStepIds = [
            ...new Set(body.completedStepIds.filter((id) => validIds.has(id)))
          ];
          // Timed occurrences never adopt a date-only legacy row: that would
          // collapse split blocks after migration. Legacy is reserved for an
          // explicitly unscheduled/manual occurrence.
          const lookupKeys =
            requestedOccurrenceKey === 'legacy' ? ['legacy'] : [requestedOccurrenceKey];
          const candidates = await tx
            .select()
            .from(classMeetings)
            .where(
              and(
                eq(classMeetings.sectionId, body.sectionId),
                eq(classMeetings.meetingDate, body.meetingDate),
                inArray(classMeetings.occurrenceKey, lookupKeys)
              )
            )
            .orderBy(desc(classMeetings.occurrenceKey));
          const existing =
            candidates.find((meeting) => meeting.occurrenceKey === requestedOccurrenceKey) ?? null;
          if (existing && existing.lessonId !== body.lessonId) {
            const [scheduledLesson] = await tx
              .select({ id: lessons.id, title: lessons.title })
              .from(lessons)
              .where(eq(lessons.id, existing.lessonId))
              .limit(1);
            throw new MeetingRevisionConflictError(
              'This class is scheduled for a different lesson today.',
              scheduledLesson ?? null
            );
          }
          if (existing && body.expectedRevision !== existing.revision) {
            throw new MeetingRevisionConflictError();
          }
          const historicalState = await tx
            .select({
              historicalCompletedSegmentIds: sectionLessonState.historicalCompletedSegmentIds,
              lastTaughtDate: sectionLessonState.lastTaughtDate
            })
            .from(sectionLessonState)
            .where(
              and(
                eq(sectionLessonState.sectionId, body.sectionId),
                eq(sectionLessonState.lessonId, body.lessonId)
              )
            )
            .limit(1);
          const existingSnapshot = existing?.stepSnapshot ?? null;
          const snapshot = existingSnapshot
            ? existingSnapshot.map((step) => ({
                ...step,
                // The snapshot is the curriculum as this occurrence first saw
                // it. Later editing must never add/rename/reorder history;
                // only completion for IDs already in the snapshot may change.
                completed: completedStepIds.includes(step.id)
                  ? true
                  : validIds.has(step.id)
                    ? false
                    : step.completed
              }))
            : existing
              ? null
              : steps.map((step) => ({
                  id: step.id,
                  title: step.title,
                  order: step.orderIndex,
                  completed: completedStepIds.includes(step.id)
                }));
          const now = new Date();
          let meeting = existing;
          if (existing) {
            const [updated] = await tx
              .update(classMeetings)
              .set({
                completedStepIds,
                stepSnapshot: snapshot,
                rawNote: body.rawNote,
                status: existing.status === 'ended' || body.endClass ? 'ended' : 'in_progress',
                endedAt: existing.endedAt ?? (body.endClass ? now : null),
                revision: existing.revision + 1,
                updatedAt: now
              })
              .where(
                and(
                  eq(classMeetings.id, existing.id),
                  eq(classMeetings.revision, existing.revision)
                )
              )
              .returning();
            if (!updated) throw new MeetingRevisionConflictError();
            meeting = updated;
          } else {
            const [created] = await tx
              .insert(classMeetings)
              .values({
                sectionId: body.sectionId,
                lessonId: body.lessonId,
                meetingDate: body.meetingDate,
                occurrenceKey: requestedOccurrenceKey,
                scheduledStartTime: body.scheduledStartTime,
                scheduledEndTime: body.scheduledEndTime,
                origin: body.origin,
                completedStepIds,
                stepSnapshot: snapshot,
                rawNote: body.rawNote,
                status: body.endClass ? 'ended' : 'in_progress',
                endedAt: body.endClass ? now : null
              })
              .onConflictDoNothing()
              .returning();
            if (!created) throw new MeetingRevisionConflictError();
            meeting = created;
          }
          if (!meeting) throw new Error('Failed to save class meeting');
          const history = await tx
            .select({ id: classMeetings.id, completedStepIds: classMeetings.completedStepIds })
            .from(classMeetings)
            .where(
              and(
                eq(classMeetings.sectionId, body.sectionId),
                eq(classMeetings.lessonId, body.lessonId)
              )
            );
          const priorCompletedStepIds = [
            ...new Set([
              ...(historicalState[0]?.historicalCompletedSegmentIds ?? []),
              ...history
                .filter((item) => item.id !== meeting.id)
                .flatMap((item) => item.completedStepIds)
            ])
          ].filter((id) => validIds.has(id));
          const cumulativeCompletedStepIds = [
            ...new Set([...priorCompletedStepIds, ...completedStepIds])
          ];
          const firstIncomplete = steps.find(
            (step) => !cumulativeCompletedStepIds.includes(step.id)
          );
          const stoppedAfterStepId = firstIncomplete
            ? (steps[steps.indexOf(firstIncomplete) - 1]?.id ?? null)
            : (steps.at(-1)?.id ?? null);
          const stoppingPointStepId = firstIncomplete?.id ?? null;
          const lessonCompleted =
            steps.length > 0 && steps.every((step) => cumulativeCompletedStepIds.includes(step.id));
          const stateStatus = lessonCompleted
            ? 'completed'
            : meeting.status === 'ended'
              ? 'stopped_at_segment'
              : 'in_progress';
          const lastTaughtDate =
            historicalState[0]?.lastTaughtDate &&
            historicalState[0].lastTaughtDate > body.meetingDate
              ? historicalState[0].lastTaughtDate
              : body.meetingDate;
          await tx
            .update(classMeetings)
            .set({ stoppedAfterStepId, stoppingPointStepId, updatedAt: now })
            .where(eq(classMeetings.id, meeting.id));
          await tx
            .insert(sectionLessonState)
            .values({
              sectionId: body.sectionId,
              lessonId: body.lessonId,
              status: stateStatus,
              currentSegmentId: stoppingPointStepId,
              stoppedAtSegmentId: stoppingPointStepId,
              completedSegmentIds: cumulativeCompletedStepIds,
              historicalCompletedSegmentIds: [],
              carryOverNote: body.rawNote,
              lastTaughtDate
            })
            .onConflictDoUpdate({
              target: [sectionLessonState.sectionId, sectionLessonState.lessonId],
              set: {
                status: stateStatus,
                currentSegmentId: stoppingPointStepId,
                stoppedAtSegmentId: stoppingPointStepId,
                completedSegmentIds: cumulativeCompletedStepIds,
                carryOverNote: body.rawNote,
                lastTaughtDate,
                updatedAt: now
              }
            });
          if (body.rawNote === null) {
            await tx
              .delete(classNotes)
              .where(
                and(
                  eq(classNotes.sectionId, body.sectionId),
                  eq(classNotes.userId, user.id),
                  eq(classNotes.date, body.meetingDate),
                  eq(classNotes.noteType, 'raw')
                )
              );
          } else {
            await tx
              .insert(classNotes)
              .values({
                sectionId: body.sectionId,
                userId: user.id,
                date: body.meetingDate,
                noteType: 'raw',
                content: body.rawNote
              })
              .onConflictDoUpdate({
                target: [
                  classNotes.sectionId,
                  classNotes.userId,
                  classNotes.date,
                  classNotes.noteType
                ],
                set: { content: body.rawNote, updatedAt: now }
              });
          }
          return ClassMeetingResponseSchema.parse({
            id: meeting.id,
            status: meeting.status,
            completedStepIds: meeting.completedStepIds,
            stoppedAfterStepId,
            rawNote: meeting.rawNote,
            meetingDate: meeting.meetingDate,
            scheduledStartTime: meeting.scheduledStartTime?.slice(0, 5) ?? null,
            scheduledEndTime: meeting.scheduledEndTime?.slice(0, 5) ?? null,
            occurrenceKey: meeting.occurrenceKey,
            origin: meeting.origin === 'manual' ? 'manual' : 'scheduled',
            revision: meeting.revision,
            stepSnapshot: snapshot,
            stoppingPointStepId,
            endedAt: meeting.endedAt?.toISOString() ?? null,
            cumulativeCompletedStepIds,
            lessonCompleted
          });
        });
        return response;
      } catch (error) {
        if (error instanceof MeetingRevisionConflictError) {
          (reply as any).code(409);
          return {
            error: error.message,
            requestId: request.id,
            scheduledLesson: error.scheduledLesson
          };
        }
        throw error;
      }
    }
  );

  app.get(
    '/v1/sections/:sectionId/class-meeting',
    {
      schema: {
        params: SectionParamsSchema,
        querystring: ClassMeetingLookupQuerySchema,
        response: { 200: ClassMeetingLookupResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = SectionParamsSchema.parse(request.params);
      const query = ClassMeetingLookupQuerySchema.parse(request.query);
      if (!(await findOwnedLessonInSectionCourse(user.id, params.sectionId, query.lessonId))) {
        (reply as any).code(404);
        return { error: 'Section or lesson not found', requestId: request.id };
      }
      const key =
        query.origin === 'manual'
          ? `manual:${query.lessonId}`
          : meetingOccurrenceKey(query.scheduledStartTime);
      const lookupKeys = key === 'legacy' ? ['legacy'] : [key];
      const candidates = await db
        .select()
        .from(classMeetings)
        .where(
          and(
            eq(classMeetings.sectionId, params.sectionId),
            eq(classMeetings.meetingDate, query.meetingDate),
            inArray(classMeetings.occurrenceKey, lookupKeys)
          )
        );
      const meeting = candidates.find((item) => item.occurrenceKey === key) ?? null;
      if (meeting && meeting.lessonId !== query.lessonId) {
        const [scheduledLesson] = await db
          .select({ id: lessons.id, title: lessons.title })
          .from(lessons)
          .where(eq(lessons.id, meeting.lessonId))
          .limit(1);
        (reply as any).code(409);
        return {
          error: 'This class is scheduled for a different lesson today.',
          requestId: request.id,
          scheduledLesson: scheduledLesson
            ? { id: scheduledLesson.id, title: scheduledLesson.title }
            : null
        };
      }
      const steps = await db
        .select({ id: lessonSegments.id })
        .from(lessonSegments)
        .where(eq(lessonSegments.lessonId, query.lessonId));
      const validIds = new Set(steps.map((step) => step.id));
      const [state] = await db
        .select({ historicalCompletedSegmentIds: sectionLessonState.historicalCompletedSegmentIds })
        .from(sectionLessonState)
        .where(
          and(
            eq(sectionLessonState.sectionId, params.sectionId),
            eq(sectionLessonState.lessonId, query.lessonId)
          )
        )
        .limit(1);
      const history = await db
        .select({ id: classMeetings.id, completedStepIds: classMeetings.completedStepIds })
        .from(classMeetings)
        .where(
          and(
            eq(classMeetings.sectionId, params.sectionId),
            eq(classMeetings.lessonId, query.lessonId)
          )
        );
      const historicalCompletedStepIds = [
        ...new Set([
          ...(state?.historicalCompletedSegmentIds ?? []),
          ...history
            .filter((item) => item.id !== meeting?.id)
            .flatMap((item) => item.completedStepIds)
        ])
      ].filter((id) => validIds.has(id));
      const cumulative = [
        ...new Set([...historicalCompletedStepIds, ...(meeting?.completedStepIds ?? [])])
      ];
      const firstIncomplete = steps.find((step) => !cumulative.includes(step.id));
      const stoppedAfterStepId = firstIncomplete
        ? (steps[steps.indexOf(firstIncomplete) - 1]?.id ?? null)
        : (steps.at(-1)?.id ?? null);
      const lessonCompleted =
        steps.length > 0 && steps.every((step) => cumulative.includes(step.id));
      return ClassMeetingLookupResponseSchema.parse({
        historicalCompletedStepIds,
        meeting: meeting
          ? {
              id: meeting.id,
              status: meeting.status,
              completedStepIds: meeting.completedStepIds,
              stoppedAfterStepId,
              rawNote: meeting.rawNote,
              meetingDate: meeting.meetingDate,
              scheduledStartTime: meeting.scheduledStartTime?.slice(0, 5) ?? null,
              scheduledEndTime: meeting.scheduledEndTime?.slice(0, 5) ?? null,
              occurrenceKey: meeting.occurrenceKey,
              origin: meeting.origin === 'manual' ? 'manual' : 'scheduled',
              revision: meeting.revision,
              stepSnapshot: meeting.stepSnapshot ?? null,
              stoppingPointStepId: meeting.stoppingPointStepId,
              endedAt: meeting.endedAt?.toISOString() ?? null,
              cumulativeCompletedStepIds: cumulative,
              lessonCompleted
            }
          : null
      });
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
      // Compatibility path for pre-Phase-2 clients. It can only establish
      // baseline progress before any durable meeting history exists; otherwise
      // it would make the materialized section state contradict the record.
      const [history] = await db
        .select({ id: classMeetings.id })
        .from(classMeetings)
        .where(
          and(
            eq(classMeetings.sectionId, body.sectionId),
            eq(classMeetings.lessonId, body.lessonId)
          )
        )
        .limit(1);
      if (history) {
        (reply as any).code(409);
        return {
          error:
            'This lesson already has class-meeting history. Save through the classroom meeting endpoint.',
          requestId: request.id
        };
      }
      const segmentRows = await db
        .select({ id: lessonSegments.id })
        .from(lessonSegments)
        .where(eq(lessonSegments.lessonId, body.lessonId));
      const validSegmentIds = new Set(segmentRows.map((segment) => segment.id));
      const completedSegmentIds = [
        ...new Set(body.completedSegmentIds.filter((id) => validSegmentIds.has(id)))
      ];
      const currentSegmentId =
        body.currentSegmentId && validSegmentIds.has(body.currentSegmentId)
          ? body.currentSegmentId
          : null;
      const stoppedAtSegmentId =
        body.stoppedAtSegmentId && validSegmentIds.has(body.stoppedAtSegmentId)
          ? body.stoppedAtSegmentId
          : null;
      let state: { id: string; updatedAt: Date } | undefined;
      try {
        [state] = await db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext(${`${body.sectionId}:${body.lessonId}`}))`
          );
          const [lockedHistory] = await tx
            .select({ id: classMeetings.id })
            .from(classMeetings)
            .where(
              and(
                eq(classMeetings.sectionId, body.sectionId),
                eq(classMeetings.lessonId, body.lessonId)
              )
            )
            .limit(1);
          if (lockedHistory) throw new MeetingHistoryExistsError();
          return tx
            .insert(sectionLessonState)
            .values({
              sectionId: body.sectionId,
              lessonId: body.lessonId,
              status: body.status,
              currentSegmentId,
              stoppedAtSegmentId,
              completedSegmentIds,
              historicalCompletedSegmentIds: completedSegmentIds,
              carryOverNote: body.carryOverNote,
              lastTaughtDate: body.lastTaughtDate
            })
            .onConflictDoUpdate({
              target: [sectionLessonState.sectionId, sectionLessonState.lessonId],
              set: {
                status: body.status,
                currentSegmentId,
                stoppedAtSegmentId,
                completedSegmentIds,
                historicalCompletedSegmentIds: completedSegmentIds,
                carryOverNote: body.carryOverNote,
                lastTaughtDate: body.lastTaughtDate,
                updatedAt: new Date()
              }
            })
            .returning({
              id: sectionLessonState.id,
              updatedAt: sectionLessonState.updatedAt
            });
        });
      } catch (error) {
        if (error instanceof MeetingHistoryExistsError) {
          (reply as any).code(409);
          return { error: error.message, requestId: request.id };
        }
        throw error;
      }
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
    '/v1/ai/parse-school-calendar/queue',
    {
      schema: {
        body: CalendarImportRequestSchema,
        response: {
          200: AiJobEnqueueResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      const body = CalendarImportRequestSchema.parse(request.body);
      if (!hasScheduleImportInput(body)) {
        (reply as any).code(400);
        return {
          error: 'Paste calendar text or upload a calendar image/PDF',
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
          type: 'parse_school_calendar',
          status: 'queued',
          input: body
        })
        .returning({ id: aiJobs.id, status: aiJobs.status });
      if (!job) throw new Error('Failed to create AI job');

      try {
        await enqueueAiJob(app.aiQueue, job.id, { attempts: 1 });
      } catch {
        await db
          .update(aiJobs)
          .set({
            status: 'cancelled',
            cancelRequested: true,
            error: 'The AI queue was unavailable while starting this job.',
            updatedAt: new Date()
          })
          .where(eq(aiJobs.id, job.id));
        (reply as any).code(503);
        return {
          error: 'The AI queue is temporarily unavailable. Using the direct calendar reader.',
          requestId: request.id
        };
      }
      return { jobId: job.id, status: job.status };
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

      try {
        await enqueueAiJob(app.aiQueue, job.id);
      } catch {
        await db
          .update(aiJobs)
          .set({
            status: 'cancelled',
            cancelRequested: true,
            error: 'The AI queue was unavailable while starting this job.',
            updatedAt: new Date()
          })
          .where(eq(aiJobs.id, job.id));
        (reply as any).code(503);
        return {
          error: 'The AI queue is temporarily unavailable. Using the direct schedule reader.',
          requestId: request.id
        };
      }
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
        type: job.type as
          | 'parse_schedule'
          | 'parse_school_calendar'
          | 'generate_segments'
          | 'generate_continuity'
          | 'generate_unit_draft',
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
          systemPrompt: scheduleImportSystemPrompt,
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
            'Create one concise, classroom-ready curriculum unit. Return a practical sequence of lessons, each with a clear objective, materials, and three to six ordered lesson steps. Write all teacher-facing plans, titles, objectives, descriptions, materials, directions, and steps in English, even when the course teaches another language such as Spanish. Use target-language words or examples only where instruction requires them. This is a draft for a teacher to review, never an instruction to alter stored curriculum.',
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
            'Generate practical, classroom-ready lesson segments with realistic durations and concise descriptions. Write the lesson plan and teacher-facing directions in English, even when the course teaches another language such as Spanish. Use target-language words or examples only where instruction requires them.',
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
            'You are helping a teacher continue the next class smoothly. Keep output concise and practical. Write all teacher-facing guidance in English, even when the course teaches another language such as Spanish.',
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
