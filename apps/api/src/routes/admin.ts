import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  AdminClaimRequestCreateSchema,
  AdminClaimRequestResponseSchema,
  AdminClaimReviewRequestSchema,
  AdminClaimReviewResponseSchema,
  AdminCalendarResponseSchema,
  AdminCourseDetailResponseSchema,
  AdminCourseListResponseSchema,
  AdminCurriculumResponseSchema,
  AdminInvitePolicyUpdateRequestSchema,
  AdminMembershipStatusUpdateRequestSchema,
  AdminMembershipStatusUpdateResponseSchema,
  AdminOverviewResponseSchema,
  AdminScheduleQuerySchema,
  AdminScheduleResponseSchema,
  AdminSchoolInvitationRevokeResponseSchema,
  AdminSchoolResponseSchema,
  AdminTeacherDetailResponseSchema,
  AdminTeacherInviteRequestSchema,
  AdminTeacherInviteResponseSchema,
  AdminTeacherListResponseSchema,
  SectionMeetingOverrideRequestSchema,
  SectionMeetingSchema,
  UuidSchema
} from '@teacheros/contracts';
import {
  courseCollaborators,
  courseShares,
  courses,
  db,
  lessons,
  notifications,
  schoolCalendarEvents,
  schoolClaimRequests,
  schoolInvitations,
  schoolHolidays,
  schoolMemberships,
  sectionMeetingOverrides,
  sectionMeetings,
  sections,
  schools,
  teacherCourses,
  teacherProfiles,
  units,
  users
} from '@teacheros/db';

import { ensureUserFromPrincipal } from '../services/user-service.js';
import { canAccessAdminWorkspace, getSchoolAccess } from '../services/permissions.js';
import { buildMeetingInstances, loadActiveSchoolYear } from '../services/meeting-instances.js';
import { validTimeZone } from '../services/schedule-resolution.js';

const TeacherParamsSchema = z.object({ teacherId: UuidSchema });
const CourseParamsSchema = z.object({ courseId: UuidSchema });
const ClaimParamsSchema = z.object({ claimId: UuidSchema });
const MemberParamsSchema = z.object({ userId: UuidSchema });
const AdminOverrideParamsSchema = z.object({ overrideId: UuidSchema });
const AdminOverrideRequestSchema = z.intersection(
  SectionMeetingOverrideRequestSchema,
  z.object({ sectionId: UuidSchema })
);

function normalizeTime(value: string | null): string | null {
  return value ? value.slice(0, 5) : null;
}

function weekdayForIsoDate(value: string): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    new Date(`${value}T12:00:00Z`).getUTCDay()
  ]!;
}

function requirePrincipal(request: FastifyRequest, reply: FastifyReply) {
  if (!request.principal) {
    (reply as any).code(401).send({ error: 'Unauthorized', requestId: request.id });
    return null;
  }
  return request.principal;
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const principal = requirePrincipal(request, reply);
  if (!principal) return null;
  const user = await ensureUserFromPrincipal(principal);
  const access = await getSchoolAccess(user.id);
  if (!access) {
    (reply as any)
      .code(404)
      .send({ error: 'Finish setting up your profile first.', requestId: request.id });
    return null;
  }
  if (!(await canAccessAdminWorkspace(user.id, access.schoolId))) {
    (reply as any)
      .code(403)
      .send({ error: 'Administrator access is required.', requestId: request.id });
    return null;
  }
  return { userId: user.id, schoolId: access.schoolId };
}

async function countRows(table: any, condition: any) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(table)
    .where(condition);
  return row?.count ?? 0;
}

async function buildTeacherSummary(schoolId: string, teacherId: string) {
  const [profile] = await db
    .select({
      userId: users.id,
      fullName: users.fullName,
      email: users.email,
      membershipRole: schoolMemberships.role,
      membershipStatus: schoolMemberships.status,
      subjects: teacherProfiles.subjects,
      grades: teacherProfiles.grades,
      joinedAt: teacherProfiles.createdAt
    })
    .from(teacherProfiles)
    .innerJoin(users, eq(teacherProfiles.userId, users.id))
    .leftJoin(
      schoolMemberships,
      and(
        eq(schoolMemberships.userId, teacherProfiles.userId),
        eq(schoolMemberships.schoolId, schoolId)
      )
    )
    .where(and(eq(teacherProfiles.userId, teacherId), eq(teacherProfiles.schoolId, schoolId)))
    .limit(1);
  if (!profile) return null;

  const role = profile.membershipRole ?? 'teacher';
  const membershipStatus = profile.membershipStatus ?? 'inactive';
  const courseCount = await countRows(
    courses,
    and(
      eq(courses.schoolId, schoolId),
      eq(courses.teacherId, teacherId),
      isNull(courses.archivedAt)
    )
  );
  const [sectionTotals] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sections)
    .innerJoin(courses, eq(sections.courseId, courses.id))
    .where(
      and(
        eq(sections.teacherId, teacherId),
        eq(courses.schoolId, schoolId),
        isNull(courses.archivedAt)
      )
    );
  const [scheduledTotals] = await db
    .select({ count: sql<number>`count(distinct ${sections.id})::int` })
    .from(sections)
    .innerJoin(courses, eq(sections.courseId, courses.id))
    .innerJoin(sectionMeetings, eq(sectionMeetings.sectionId, sections.id))
    .where(
      and(
        eq(sections.teacherId, teacherId),
        eq(courses.schoolId, schoolId),
        isNull(courses.archivedAt)
      )
    );
  const [curriculumTotal] = await db
    .select({ count: sql<number>`count(distinct ${teacherCourses.id})::int` })
    .from(teacherCourses)
    .innerJoin(courses, eq(teacherCourses.curriculumId, courses.id))
    .innerJoin(courseShares, eq(courseShares.courseId, courses.id))
    .where(
      and(
        eq(teacherCourses.teacherId, teacherId),
        eq(courses.schoolId, schoolId),
        eq(courseShares.enabled, true),
        eq(courseShares.schoolVisible, true)
      )
    );

  return {
    userId: profile.userId,
    fullName: profile.fullName,
    email: profile.email,
    role,
    membershipStatus,
    courseCount,
    sectionCount: sectionTotals?.count ?? 0,
    scheduledSectionCount: scheduledTotals?.count ?? 0,
    curriculumCount: curriculumTotal?.count ?? 0,
    subjects: profile.subjects ?? [],
    grades: profile.grades ?? [],
    joinedAt: profile.joinedAt.toISOString()
  };
}

async function listSchoolTeachers(schoolId: string) {
  const rows = await db
    .select({ userId: teacherProfiles.userId })
    .from(teacherProfiles)
    .where(eq(teacherProfiles.schoolId, schoolId));
  const summaries = await Promise.all(rows.map((row) => buildTeacherSummary(schoolId, row.userId)));
  return summaries.filter((summary): summary is NonNullable<typeof summary> => Boolean(summary));
}

async function buildAdminCalendar(schoolId: string, request?: FastifyRequest) {
  const [school] = await db
    .select({ timezone: schools.timezone })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);
  const timezone =
    validTimeZone(school?.timezone) ??
    validTimeZone(
      typeof request?.headers['x-teacher-timezone'] === 'string'
        ? request.headers['x-teacher-timezone']
        : null
    ) ??
    'UTC';
  const schoolYear = await loadActiveSchoolYear(schoolId, timezone);
  const events = schoolYear
    ? await db
        .select({
          id: schoolCalendarEvents.id,
          date: schoolCalendarEvents.date,
          type: schoolCalendarEvents.type,
          label: schoolCalendarEvents.label,
          confidence: schoolCalendarEvents.confidence,
          sourceText: schoolCalendarEvents.sourceText
        })
        .from(schoolCalendarEvents)
        .where(eq(schoolCalendarEvents.schoolYearId, schoolYear.id))
        .orderBy(asc(schoolCalendarEvents.date), asc(schoolCalendarEvents.label))
    : [];
  const legacyHolidays = await db
    .select({ id: schoolHolidays.id, date: schoolHolidays.date, label: schoolHolidays.name })
    .from(schoolHolidays)
    .where(
      and(
        eq(schoolHolidays.schoolId, schoolId),
        schoolYear ? gte(schoolHolidays.date, schoolYear.startDate) : undefined,
        schoolYear ? lte(schoolHolidays.date, schoolYear.endDate) : undefined
      )
    )
    .orderBy(asc(schoolHolidays.date), asc(schoolHolidays.name));
  const sectionRows = await db
    .select({
      id: sections.id,
      courseId: courses.id,
      courseName: courses.name,
      sectionName: sections.name,
      meetingId: sectionMeetings.id,
      day: sectionMeetings.day,
      time: sectionMeetings.meetingTime,
      endTime: sectionMeetings.endTime,
      room: sectionMeetings.room
    })
    .from(sections)
    .innerJoin(courses, eq(sections.courseId, courses.id))
    .leftJoin(sectionMeetings, eq(sectionMeetings.sectionId, sections.id))
    .where(and(eq(courses.schoolId, schoolId), isNull(courses.archivedAt)))
    .orderBy(asc(courses.name), asc(sections.name), asc(sectionMeetings.meetingTime));
  const sectionMap = new Map<
    string,
    { id: string; courseId: string; courseName: string; name: string; meetings: any[] }
  >();
  for (const row of sectionRows) {
    const section = sectionMap.get(row.id) ?? {
      id: row.id,
      courseId: row.courseId,
      courseName: row.courseName,
      name: row.sectionName,
      meetings: []
    };
    if (row.meetingId) {
      section.meetings.push(
        SectionMeetingSchema.parse({
          day: row.day,
          time: normalizeTime(row.time),
          endTime: normalizeTime(row.endTime),
          room: row.room
        })
      );
    }
    sectionMap.set(row.id, section);
  }
  const overrideRows = await db
    .select({
      id: sectionMeetingOverrides.id,
      sectionId: sections.id,
      courseId: courses.id,
      courseName: courses.name,
      sectionName: sections.name,
      date: sectionMeetingOverrides.date,
      occurrenceKey: sectionMeetingOverrides.occurrenceKey,
      startTime: sectionMeetingOverrides.startTime,
      endTime: sectionMeetingOverrides.endTime,
      room: sectionMeetingOverrides.room,
      cancelled: sectionMeetingOverrides.cancelled
    })
    .from(sectionMeetingOverrides)
    .innerJoin(sections, eq(sectionMeetingOverrides.sectionId, sections.id))
    .innerJoin(courses, eq(sections.courseId, courses.id))
    .where(and(eq(courses.schoolId, schoolId), isNull(courses.archivedAt)))
    .orderBy(asc(sectionMeetingOverrides.date), asc(courses.name), asc(sections.name));
  return AdminCalendarResponseSchema.parse({
    schoolYear: schoolYear
      ? { id: schoolYear.id, startDate: schoolYear.startDate, endDate: schoolYear.endDate }
      : null,
    events: [
      ...events,
      ...legacyHolidays.map((holiday) => ({
        id: holiday.id,
        date: holiday.date,
        type: 'no_school' as const,
        label: holiday.label,
        confidence: 100,
        sourceText: 'Existing teacher calendar holiday',
        legacy: true
      }))
    ].sort((left, right) =>
      `${left.date}:${left.label}`.localeCompare(`${right.date}:${right.label}`)
    ),
    isShared: true,
    timezone,
    sections: Array.from(sectionMap.values()),
    overrides: overrideRows.map((override) => ({
      ...override,
      startTime: normalizeTime(override.startTime),
      endTime: normalizeTime(override.endTime)
    }))
  });
}

export async function adminRoutes(app: FastifyInstance) {
  app.get(
    '/v1/admin',
    { schema: { response: { 200: AdminOverviewResponseSchema } } },
    async (request, reply) => {
      const context = await requireAdmin(request, reply);
      if (!context) return;
      const [school] = await db
        .select({
          id: schools.id,
          name: schools.name,
          district: schools.district,
          state: schools.state,
          timezone: schools.timezone,
          claimStatus: schools.claimStatus,
          invitePolicy: schools.teacherInvitePolicy
        })
        .from(schools)
        .where(eq(schools.id, context.schoolId))
        .limit(1);
      if (!school) {
        (reply as any).code(404);
        return { error: 'School not found', requestId: request.id };
      }
      const teachers = await listSchoolTeachers(context.schoolId);
      const [coursesTotal] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(courses)
        .where(and(eq(courses.schoolId, context.schoolId), isNull(courses.archivedAt)));
      const [sectionsTotal] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(sections)
        .innerJoin(courses, eq(sections.courseId, courses.id))
        .where(and(eq(courses.schoolId, context.schoolId), isNull(courses.archivedAt)));
      const [curriculumTotal] = await db
        .select({ count: sql<number>`count(distinct ${courses.id})::int` })
        .from(courses)
        .innerJoin(units, eq(units.courseId, courses.id))
        .innerJoin(courseShares, eq(courseShares.courseId, courses.id))
        .where(
          and(
            eq(courses.schoolId, context.schoolId),
            isNull(courses.archivedAt),
            eq(courseShares.enabled, true),
            eq(courseShares.schoolVisible, true)
          )
        );
      const [sharedTotal] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(courseShares)
        .innerJoin(courses, eq(courseShares.courseId, courses.id))
        .where(
          and(
            eq(courses.schoolId, context.schoolId),
            isNull(courses.archivedAt),
            eq(courseShares.enabled, true),
            eq(courseShares.schoolVisible, true)
          )
        );
      const calendar = await buildAdminCalendar(context.schoolId, request);
      return AdminOverviewResponseSchema.parse({
        school: {
          ...school,
          timezone: validTimeZone(school.timezone) ?? calendar.timezone
        },
        counts: {
          teachers: teachers.filter(
            (teacher) => teacher.role === 'teacher' && teacher.membershipStatus === 'active'
          ).length,
          courses: coursesTotal?.count ?? 0,
          sections: sectionsTotal?.count ?? 0,
          coursesWithCurriculum: curriculumTotal?.count ?? 0,
          teachersWithSchedule: teachers.filter(
            (teacher) =>
              teacher.role === 'teacher' &&
              teacher.membershipStatus === 'active' &&
              teacher.scheduledSectionCount > 0
          ).length,
          schoolSharedCurricula: sharedTotal?.count ?? 0
        },
        calendar: {
          configured: Boolean(calendar.schoolYear),
          schoolYear: calendar.schoolYear
        }
      });
    }
  );

  app.get(
    '/v1/admin/teachers',
    { schema: { response: { 200: AdminTeacherListResponseSchema } } },
    async (request, reply) => {
      const context = await requireAdmin(request, reply);
      if (!context) return;
      return AdminTeacherListResponseSchema.parse({
        teachers: (await listSchoolTeachers(context.schoolId)).filter(
          (teacher) => teacher.role === 'teacher'
        )
      });
    }
  );

  app.get(
    '/v1/admin/teachers/:teacherId',
    {
      schema: {
        params: TeacherParamsSchema,
        response: { 200: AdminTeacherDetailResponseSchema }
      }
    },
    async (request, reply) => {
      const context = await requireAdmin(request, reply);
      if (!context) return;
      const { teacherId } = TeacherParamsSchema.parse(request.params);
      const teacher = await buildTeacherSummary(context.schoolId, teacherId);
      if (!teacher || teacher.role !== 'teacher') {
        (reply as any).code(404);
        return { error: 'Teacher not found', requestId: request.id };
      }
      const teacherCoursesRows = await db
        .select({
          id: courses.id,
          name: courses.name,
          subject: courses.subject,
          gradeLevel: courses.gradeLevel,
          archivedAt: courses.archivedAt
        })
        .from(courses)
        .where(and(eq(courses.teacherId, teacherId), eq(courses.schoolId, context.schoolId)))
        .orderBy(asc(courses.sortIndex), asc(courses.name));
      const teacherSections = await db
        .select({
          id: sections.id,
          courseId: courses.id,
          courseName: courses.name,
          name: sections.name,
          meetingId: sectionMeetings.id,
          day: sectionMeetings.day,
          time: sectionMeetings.meetingTime,
          endTime: sectionMeetings.endTime,
          room: sectionMeetings.room
        })
        .from(sections)
        .innerJoin(courses, eq(sections.courseId, courses.id))
        .leftJoin(sectionMeetings, eq(sectionMeetings.sectionId, sections.id))
        .where(and(eq(sections.teacherId, teacherId), eq(courses.schoolId, context.schoolId)))
        .orderBy(asc(courses.name), asc(sections.name), asc(sectionMeetings.meetingTime));
      const sectionsById = new Map<
        string,
        { id: string; courseId: string; courseName: string; name: string; meetings: any[] }
      >();
      for (const row of teacherSections) {
        const current = sectionsById.get(row.id) ?? {
          id: row.id,
          courseId: row.courseId,
          courseName: row.courseName,
          name: row.name,
          meetings: []
        };
        if (row.meetingId) {
          current.meetings.push(
            SectionMeetingSchema.parse({
              day: row.day,
              time: normalizeTime(row.time),
              endTime: normalizeTime(row.endTime),
              room: row.room
            })
          );
        }
        sectionsById.set(row.id, current);
      }
      return AdminTeacherDetailResponseSchema.parse({
        teacher: {
          ...teacher,
          courses: teacherCoursesRows.map((course) => ({
            ...course,
            archivedAt: course.archivedAt?.toISOString() ?? null
          })),
          sections: Array.from(sectionsById.values())
        }
      });
    }
  );

  app.get(
    '/v1/admin/schedule',
    {
      schema: {
        querystring: AdminScheduleQuerySchema,
        response: { 200: AdminScheduleResponseSchema }
      }
    },
    async (request, reply) => {
      const context = await requireAdmin(request, reply);
      if (!context) return;
      const query = AdminScheduleQuerySchema.parse(request.query);
      const recurringRows = await db
        .select({
          sectionId: sections.id,
          courseId: courses.id,
          teacherId: users.id,
          teacherName: users.fullName,
          teacherEmail: users.email,
          courseName: courses.name,
          sectionName: sections.name,
          day: sectionMeetings.day,
          startTime: sectionMeetings.meetingTime,
          endTime: sectionMeetings.endTime,
          room: sectionMeetings.room
        })
        .from(sectionMeetings)
        .innerJoin(sections, eq(sectionMeetings.sectionId, sections.id))
        .innerJoin(courses, eq(sections.courseId, courses.id))
        .innerJoin(users, eq(sections.teacherId, users.id))
        .innerJoin(teacherProfiles, eq(teacherProfiles.userId, users.id))
        .innerJoin(
          schoolMemberships,
          and(
            eq(schoolMemberships.userId, users.id),
            eq(schoolMemberships.schoolId, context.schoolId),
            eq(schoolMemberships.status, 'active')
          )
        )
        .where(
          and(
            eq(courses.schoolId, context.schoolId),
            eq(teacherProfiles.schoolId, context.schoolId),
            isNull(courses.archivedAt),
            or(eq(sectionMeetings.day, 'A-Day'), eq(sectionMeetings.day, 'B-Day')),
            query.day && (query.day === 'A-Day' || query.day === 'B-Day')
              ? eq(sectionMeetings.day, query.day)
              : undefined,
            query.teacherId ? eq(sections.teacherId, query.teacherId) : undefined,
            query.courseId ? eq(courses.id, query.courseId) : undefined
          )
        )
        .orderBy(asc(sectionMeetings.day), asc(sectionMeetings.meetingTime), asc(courses.name));

      const schoolTeachers = (await listSchoolTeachers(context.schoolId)).filter(
        (teacher) =>
          teacher.role === 'teacher' &&
          teacher.membershipStatus === 'active' &&
          (!query.teacherId || teacher.userId === query.teacherId)
      );
      const calendar = await buildAdminCalendar(context.schoolId, request);
      const effectiveEntries = (
        await Promise.all(
          schoolTeachers.map(async (teacher) => {
            const result = await buildMeetingInstances(teacher.userId, context.schoolId, {
              startDate: query.startDate,
              endDate: query.endDate,
              timeZone: calendar.timezone
            });
            return result.meetings.flatMap((meeting) => {
              if (query.courseId && meeting.courseId !== query.courseId) return [];
              const day = weekdayForIsoDate(meeting.date);
              if (query.day && day !== query.day) return [];
              return [
                {
                  sectionId: meeting.sectionId,
                  courseId: meeting.courseId,
                  teacherId: teacher.userId,
                  date: meeting.date,
                  effective: true,
                  teacherName: teacher.fullName,
                  teacherEmail: teacher.email,
                  courseName: meeting.courseName,
                  sectionName: meeting.sectionName,
                  day,
                  startTime: meeting.startTime,
                  endTime: meeting.endTime,
                  room: meeting.room
                }
              ];
            });
          })
        )
      ).flat();

      const recurringEntries = recurringRows
        .filter((row) => !query.day || row.day === query.day)
        .map((row) => ({
          ...row,
          date: null,
          effective: false,
          startTime: normalizeTime(row.startTime),
          endTime: normalizeTime(row.endTime)
        }));
      return AdminScheduleResponseSchema.parse({
        entries: [...effectiveEntries, ...recurringEntries].sort((left, right) =>
          `${left.date ?? '9999-99-99'}:${left.startTime ?? ''}:${left.courseName}`.localeCompare(
            `${right.date ?? '9999-99-99'}:${right.startTime ?? ''}:${right.courseName}`
          )
        )
      });
    }
  );

  async function buildCourseSummary(schoolId: string, courseId: string) {
    const [course] = await db
      .select({
        id: courses.id,
        name: courses.name,
        subject: courses.subject,
        gradeLevel: courses.gradeLevel,
        archivedAt: courses.archivedAt,
        ownerId: users.id,
        ownerName: users.fullName,
        ownerEmail: users.email,
        shared: courseShares.enabled,
        schoolVisible: courseShares.schoolVisible
      })
      .from(courses)
      .innerJoin(users, eq(courses.teacherId, users.id))
      .leftJoin(courseShares, eq(courseShares.courseId, courses.id))
      .where(and(eq(courses.id, courseId), eq(courses.schoolId, schoolId)))
      .limit(1);
    if (!course) return null;
    const teacherRows = await db
      .select({ userId: users.id, fullName: users.fullName, email: users.email })
      .from(users)
      .innerJoin(teacherProfiles, eq(teacherProfiles.userId, users.id))
      .innerJoin(
        schoolMemberships,
        and(
          eq(schoolMemberships.userId, users.id),
          eq(schoolMemberships.schoolId, schoolId),
          eq(schoolMemberships.status, 'active')
        )
      )
      .where(and(eq(users.id, course.ownerId), eq(teacherProfiles.schoolId, schoolId)));
    const collaborators = await db
      .select({ userId: users.id, fullName: users.fullName, email: users.email })
      .from(courseCollaborators)
      .innerJoin(users, eq(courseCollaborators.userId, users.id))
      .innerJoin(teacherProfiles, eq(teacherProfiles.userId, users.id))
      .innerJoin(
        schoolMemberships,
        and(
          eq(schoolMemberships.userId, users.id),
          eq(schoolMemberships.schoolId, schoolId),
          eq(schoolMemberships.status, 'active')
        )
      )
      .where(
        and(
          eq(courseCollaborators.courseId, courseId),
          eq(courseCollaborators.status, 'accepted'),
          isNull(courseCollaborators.archivedAt),
          eq(teacherProfiles.schoolId, schoolId)
        )
      );
    const teachers = [...teacherRows, ...collaborators].filter(
      (teacher, index, all) => all.findIndex((other) => other.userId === teacher.userId) === index
    );
    const [unitsTotal] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(units)
      .where(eq(units.courseId, courseId));
    const [lessonsTotal] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(lessons)
      .innerJoin(units, eq(lessons.unitId, units.id))
      .where(eq(units.courseId, courseId));
    const [sectionsTotal] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sections)
      .where(eq(sections.courseId, courseId));
    const shared = Boolean(course.shared && course.schoolVisible);
    return {
      id: course.id,
      name: course.name,
      subject: course.subject,
      gradeLevel: course.gradeLevel,
      archivedAt: course.archivedAt?.toISOString() ?? null,
      teacherCount: teachers.length,
      sectionCount: sectionsTotal?.count ?? 0,
      unitCount: shared ? (unitsTotal?.count ?? 0) : 0,
      lessonCount: shared ? (lessonsTotal?.count ?? 0) : 0,
      shared,
      teachers
    };
  }

  app.get(
    '/v1/admin/courses',
    { schema: { response: { 200: AdminCourseListResponseSchema } } },
    async (request, reply) => {
      const context = await requireAdmin(request, reply);
      if (!context) return;
      const rows = await db
        .select({ id: courses.id })
        .from(courses)
        .where(and(eq(courses.schoolId, context.schoolId), isNull(courses.archivedAt)))
        .orderBy(asc(courses.sortIndex), asc(courses.name));
      const summaries = await Promise.all(
        rows.map((row) => buildCourseSummary(context.schoolId, row.id))
      );
      return AdminCourseListResponseSchema.parse({
        courses: summaries.filter((summary): summary is NonNullable<typeof summary> =>
          Boolean(summary)
        )
      });
    }
  );

  app.get(
    '/v1/admin/courses/:courseId',
    {
      schema: {
        params: CourseParamsSchema,
        response: { 200: AdminCourseDetailResponseSchema }
      }
    },
    async (request, reply) => {
      const context = await requireAdmin(request, reply);
      if (!context) return;
      const { courseId } = CourseParamsSchema.parse(request.params);
      const summary = await buildCourseSummary(context.schoolId, courseId);
      if (!summary) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }
      const unitRows = summary.shared
        ? await db
            .select({
              id: units.id,
              title: units.title,
              orderIndex: units.orderIndex,
              plannedStartMeeting: units.plannedStartMeeting,
              plannedMeetingCount: units.plannedMeetingCount,
              lessonCount: sql<number>`count(${lessons.id})::int`
            })
            .from(units)
            .leftJoin(lessons, eq(lessons.unitId, units.id))
            .where(eq(units.courseId, courseId))
            .groupBy(units.id)
            .orderBy(asc(units.orderIndex))
        : [];
      const sectionRows = await db
        .select({
          id: sections.id,
          teacherId: sections.teacherId,
          teacherName: users.fullName,
          name: sections.name,
          meetingId: sectionMeetings.id,
          day: sectionMeetings.day,
          time: sectionMeetings.meetingTime,
          endTime: sectionMeetings.endTime,
          room: sectionMeetings.room
        })
        .from(sections)
        .innerJoin(users, eq(sections.teacherId, users.id))
        .leftJoin(sectionMeetings, eq(sectionMeetings.sectionId, sections.id))
        .where(eq(sections.courseId, courseId))
        .orderBy(asc(sections.name), asc(sectionMeetings.meetingTime));
      const sectionMap = new Map<
        string,
        { id: string; teacherId: string; teacherName: string | null; name: string; meetings: any[] }
      >();
      for (const row of sectionRows) {
        const current = sectionMap.get(row.id) ?? {
          id: row.id,
          teacherId: row.teacherId,
          teacherName: row.teacherName,
          name: row.name,
          meetings: []
        };
        if (row.meetingId) {
          current.meetings.push(
            SectionMeetingSchema.parse({
              day: row.day,
              time: normalizeTime(row.time),
              endTime: normalizeTime(row.endTime),
              room: row.room
            })
          );
        }
        sectionMap.set(row.id, current);
      }
      const calendar = await buildAdminCalendar(context.schoolId, request);
      const courseMeetings = (
        await Promise.all(
          [...new Set(sectionRows.map((section) => section.teacherId))].map((teacherId) =>
            buildMeetingInstances(teacherId, context.schoolId, { timeZone: calendar.timezone })
          )
        )
      )
        .flatMap((result) => result.meetings)
        .filter((meeting) => meeting.courseId === courseId)
        .sort(
          (left, right) =>
            left.date.localeCompare(right.date) ||
            (left.startTime ?? '').localeCompare(right.startTime ?? '')
        );
      const projectedCourseDates = [...new Set(courseMeetings.map((meeting) => meeting.date))];
      return AdminCourseDetailResponseSchema.parse({
        course: {
          ...summary,
          units: unitRows.map((unit) => {
            const start = unit.plannedStartMeeting;
            const count = unit.plannedMeetingCount;
            const projectedStartDate =
              start !== null && count !== null ? (projectedCourseDates[start] ?? null) : null;
            const projectedEndDate =
              start !== null && count !== null
                ? (projectedCourseDates[start + Math.max(0, count - 1)] ?? null)
                : null;
            return { ...unit, projectedStartDate, projectedEndDate };
          }),
          sections: Array.from(sectionMap.values())
        }
      });
    }
  );

  app.get(
    '/v1/admin/curriculum',
    { schema: { response: { 200: AdminCurriculumResponseSchema } } },
    async (request, reply) => {
      const context = await requireAdmin(request, reply);
      if (!context) return;
      const rows = await db
        .select({
          courseId: courses.id,
          name: courses.name,
          subject: courses.subject,
          gradeLevel: courses.gradeLevel,
          ownerUserId: users.id,
          ownerFullName: users.fullName,
          ownerEmail: users.email
        })
        .from(courseShares)
        .innerJoin(courses, eq(courseShares.courseId, courses.id))
        .innerJoin(users, eq(courses.teacherId, users.id))
        .where(
          and(
            eq(courses.schoolId, context.schoolId),
            eq(courseShares.enabled, true),
            eq(courseShares.schoolVisible, true)
          )
        )
        .orderBy(asc(courses.name));
      const curricula = await Promise.all(
        rows.map(async (row) => {
          const [unitCount] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(units)
            .where(eq(units.courseId, row.courseId));
          const [lessonCount] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(lessons)
            .innerJoin(units, eq(lessons.unitId, units.id))
            .where(eq(units.courseId, row.courseId));
          const [adoption] = await db
            .select({ count: sql<number>`count(distinct ${teacherCourses.teacherId})::int` })
            .from(teacherCourses)
            .innerJoin(teacherProfiles, eq(teacherProfiles.userId, teacherCourses.teacherId))
            .innerJoin(
              schoolMemberships,
              and(
                eq(schoolMemberships.userId, teacherCourses.teacherId),
                eq(schoolMemberships.schoolId, context.schoolId),
                eq(schoolMemberships.status, 'active')
              )
            )
            .where(
              and(
                eq(teacherCourses.curriculumId, row.courseId),
                eq(teacherProfiles.schoolId, context.schoolId)
              )
            );
          return {
            courseId: row.courseId,
            name: row.name,
            subject: row.subject,
            gradeLevel: row.gradeLevel,
            owner: {
              userId: row.ownerUserId,
              fullName: row.ownerFullName,
              email: row.ownerEmail
            },
            unitCount: unitCount?.count ?? 0,
            lessonCount: lessonCount?.count ?? 0,
            adoptedByCount: adoption?.count ?? 0,
            source: 'teacher-shared' as const
          };
        })
      );
      return AdminCurriculumResponseSchema.parse({ curricula });
    }
  );

  app.post(
    '/v1/admin/calendar/overrides',
    {
      schema: {
        body: AdminOverrideRequestSchema,
        response: { 200: AdminCalendarResponseSchema }
      }
    },
    async (request, reply) => {
      const context = await requireAdmin(request, reply);
      if (!context) return;
      const body = AdminOverrideRequestSchema.parse(request.body);
      const calendar = await buildAdminCalendar(context.schoolId, request);
      if (
        !calendar.schoolYear ||
        body.date < calendar.schoolYear.startDate ||
        body.date > calendar.schoolYear.endDate
      ) {
        (reply as any).code(400);
        return {
          error: 'Override date must be inside the active school year.',
          requestId: request.id
        };
      }
      const [section] = await db
        .select({ id: sections.id })
        .from(sections)
        .innerJoin(courses, eq(sections.courseId, courses.id))
        .where(and(eq(sections.id, body.sectionId), eq(courses.schoolId, context.schoolId)))
        .limit(1);
      if (!section) {
        (reply as any).code(404);
        return { error: 'Class group not found', requestId: request.id };
      }
      const now = new Date();
      await db
        .insert(sectionMeetingOverrides)
        .values({
          sectionId: body.sectionId,
          date: body.date,
          occurrenceKey: body.scheduledStartTime?.slice(0, 5) ?? 'legacy',
          startTime: body.startTime,
          endTime: body.endTime,
          room: body.room,
          cancelled: body.cancelled,
          createdByUserId: context.userId,
          updatedAt: now
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
            updatedAt: now
          }
        });
      return buildAdminCalendar(context.schoolId, request);
    }
  );

  app.delete(
    '/v1/admin/calendar/overrides/:overrideId',
    {
      schema: {
        params: AdminOverrideParamsSchema,
        response: { 200: AdminCalendarResponseSchema }
      }
    },
    async (request, reply) => {
      const context = await requireAdmin(request, reply);
      if (!context) return;
      const { overrideId } = AdminOverrideParamsSchema.parse(request.params);
      const [override] = await db
        .select({ id: sectionMeetingOverrides.id })
        .from(sectionMeetingOverrides)
        .innerJoin(sections, eq(sectionMeetingOverrides.sectionId, sections.id))
        .innerJoin(courses, eq(sections.courseId, courses.id))
        .where(
          and(eq(sectionMeetingOverrides.id, overrideId), eq(courses.schoolId, context.schoolId))
        )
        .limit(1);
      if (!override) {
        (reply as any).code(404);
        return { error: 'Calendar override not found', requestId: request.id };
      }
      await db.delete(sectionMeetingOverrides).where(eq(sectionMeetingOverrides.id, overrideId));
      return buildAdminCalendar(context.schoolId, request);
    }
  );

  app.get(
    '/v1/admin/calendar',
    { schema: { response: { 200: AdminCalendarResponseSchema } } },
    async (request, reply) => {
      const context = await requireAdmin(request, reply);
      if (!context) return;
      return buildAdminCalendar(context.schoolId, request);
    }
  );

  app.get(
    '/v1/admin/school',
    { schema: { response: { 200: AdminSchoolResponseSchema } } },
    async (request, reply) => {
      const context = await requireAdmin(request, reply);
      if (!context) return;
      const [school] = await db
        .select({
          id: schools.id,
          name: schools.name,
          inviteCode: schools.inviteCode,
          district: schools.district,
          state: schools.state,
          timezone: schools.timezone,
          claimStatus: schools.claimStatus,
          invitePolicy: schools.teacherInvitePolicy,
          claimedAt: schools.claimedAt,
          claimedByUserId: schools.claimedByUserId
        })
        .from(schools)
        .where(eq(schools.id, context.schoolId))
        .limit(1);
      if (!school) {
        (reply as any).code(404);
        return { error: 'School not found', requestId: request.id };
      }
      const administrators = await db
        .select({
          userId: users.id,
          fullName: users.fullName,
          email: users.email,
          status: schoolMemberships.status
        })
        .from(schoolMemberships)
        .innerJoin(users, eq(schoolMemberships.userId, users.id))
        .where(
          and(eq(schoolMemberships.schoolId, context.schoolId), eq(schoolMemberships.role, 'admin'))
        );
      const invitations = await db
        .select({
          id: schoolInvitations.id,
          inviteeEmail: users.email,
          status: schoolInvitations.status,
          createdAt: schoolInvitations.createdAt,
          expiresAt: schoolInvitations.expiresAt
        })
        .from(schoolInvitations)
        .innerJoin(users, eq(schoolInvitations.inviteeUserId, users.id))
        .where(
          and(
            eq(schoolInvitations.schoolId, context.schoolId),
            eq(schoolInvitations.status, 'pending')
          )
        )
        .orderBy(desc(schoolInvitations.createdAt));
      const claims = await db
        .select({
          id: schoolClaimRequests.id,
          requesterUserId: schoolClaimRequests.requesterUserId,
          requesterName: users.fullName,
          schoolEmail: schoolClaimRequests.schoolEmail,
          position: schoolClaimRequests.position,
          verificationNotes: schoolClaimRequests.verificationNotes,
          status: schoolClaimRequests.status,
          createdAt: schoolClaimRequests.createdAt,
          reviewedAt: schoolClaimRequests.reviewedAt
        })
        .from(schoolClaimRequests)
        .innerJoin(users, eq(schoolClaimRequests.requesterUserId, users.id))
        .where(eq(schoolClaimRequests.schoolId, context.schoolId))
        .orderBy(desc(schoolClaimRequests.createdAt));
      return AdminSchoolResponseSchema.parse({
        school: {
          ...school,
          timezone: validTimeZone(school.timezone) ?? 'UTC',
          claimedAt: school.claimedAt?.toISOString() ?? null
        },
        administrators,
        invitations: invitations.map((invitation) => ({
          ...invitation,
          createdAt: invitation.createdAt.toISOString(),
          expiresAt: invitation.expiresAt.toISOString()
        })),
        pendingClaims: claims.map((claim) => ({
          ...claim,
          createdAt: claim.createdAt.toISOString(),
          reviewedAt: claim.reviewedAt?.toISOString() ?? null
        }))
      });
    }
  );

  app.patch(
    '/v1/admin/school/invite-policy',
    {
      schema: {
        body: AdminInvitePolicyUpdateRequestSchema,
        response: { 200: AdminSchoolResponseSchema }
      }
    },
    async (request, reply) => {
      const context = await requireAdmin(request, reply);
      if (!context) return;
      const body = AdminInvitePolicyUpdateRequestSchema.parse(request.body);
      await db
        .update(schools)
        .set({ teacherInvitePolicy: body.policy, updatedAt: new Date() })
        .where(eq(schools.id, context.schoolId));
      const response = await app.inject({
        method: 'GET',
        url: '/v1/admin/school',
        headers: request.headers as Record<string, string>
      });
      return AdminSchoolResponseSchema.parse(response.json());
    }
  );

  app.post(
    '/v1/admin/school/invite-code/rotate',
    { schema: { response: { 200: AdminSchoolResponseSchema } } },
    async (request, reply) => {
      const context = await requireAdmin(request, reply);
      if (!context) return;
      await db
        .update(schools)
        .set({
          inviteCode: randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase(),
          updatedAt: new Date()
        })
        .where(eq(schools.id, context.schoolId));
      const response = await app.inject({
        method: 'GET',
        url: '/v1/admin/school',
        headers: request.headers as Record<string, string>
      });
      return AdminSchoolResponseSchema.parse(response.json());
    }
  );

  app.post(
    '/v1/admin/members/invite',
    {
      schema: {
        body: AdminTeacherInviteRequestSchema,
        response: { 200: AdminTeacherInviteResponseSchema }
      }
    },
    async (request, reply) => {
      const context = await requireAdmin(request, reply);
      if (!context) return;
      const body = AdminTeacherInviteRequestSchema.parse(request.body);
      const email = body.email.toLowerCase();
      const invitees = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .innerJoin(teacherProfiles, eq(teacherProfiles.userId, users.id))
        .where(sql`lower(${users.email}) = ${email}`)
        .limit(2);
      if (invitees.length === 0) {
        (reply as any).code(404);
        return {
          error: 'That teacher needs a TeacherDesk account and profile before you can invite them.',
          requestId: request.id
        };
      }
      if (invitees.length > 1) {
        (reply as any).code(409);
        return {
          error: 'That email matches multiple accounts. Use a unique account email.',
          requestId: request.id
        };
      }
      const invitee = invitees[0]!;
      if (invitee.id === context.userId) {
        (reply as any).code(400);
        return { error: 'You already belong to this school.', requestId: request.id };
      }
      const [membership] = await db
        .select({ role: schoolMemberships.role, status: schoolMemberships.status })
        .from(schoolMemberships)
        .where(
          and(
            eq(schoolMemberships.userId, invitee.id),
            eq(schoolMemberships.schoolId, context.schoolId)
          )
        )
        .limit(1);
      if (membership?.status === 'active') {
        (reply as any).code(409);
        return { error: 'That teacher is already an active school member.', requestId: request.id };
      }
      const [existing] = await db
        .select({ id: schoolInvitations.id, status: schoolInvitations.status })
        .from(schoolInvitations)
        .where(
          and(
            eq(schoolInvitations.schoolId, context.schoolId),
            eq(schoolInvitations.inviteeUserId, invitee.id),
            eq(schoolInvitations.status, 'pending')
          )
        )
        .limit(1);
      if (existing) {
        await db.insert(notifications).values({
          recipientUserId: invitee.id,
          actorUserId: context.userId,
          type: 'school_invitation',
          title: 'School invitation reminder',
          message: 'sent you a reminder to join this school.',
          actionUrl: `/school?schoolInvitation=${existing.id}`
        });
        return AdminTeacherInviteResponseSchema.parse({
          invitationId: existing.id,
          schoolId: context.schoolId,
          inviteeEmail: invitee.email,
          status: existing.status
        });
      }
      let invitation: { id: string; status: 'pending' | 'accepted' | 'revoked' } | undefined;
      let createdNew = false;
      try {
        [invitation] = await db
          .insert(schoolInvitations)
          .values({
            schoolId: context.schoolId,
            inviteeUserId: invitee.id,
            invitedByUserId: context.userId
          })
          .returning({ id: schoolInvitations.id, status: schoolInvitations.status });
        createdNew = Boolean(invitation);
      } catch (error) {
        if ((error as { code?: string }).code !== '23505') throw error;
        [invitation] = await db
          .select({ id: schoolInvitations.id, status: schoolInvitations.status })
          .from(schoolInvitations)
          .where(
            and(
              eq(schoolInvitations.schoolId, context.schoolId),
              eq(schoolInvitations.inviteeUserId, invitee.id),
              eq(schoolInvitations.status, 'pending')
            )
          )
          .limit(1);
      }
      if (!invitation) throw new Error('Could not create school invitation');
      if (invitation.status === 'pending' && createdNew) {
        await db.insert(notifications).values({
          recipientUserId: invitee.id,
          actorUserId: context.userId,
          type: 'school_invitation',
          title: 'School invitation',
          message: 'invited you to join this school.',
          actionUrl: `/school?schoolInvitation=${invitation.id}`
        });
      }
      return AdminTeacherInviteResponseSchema.parse({
        invitationId: invitation.id,
        schoolId: context.schoolId,
        inviteeEmail: invitee.email,
        status: invitation.status
      });
    }
  );

  app.delete(
    '/v1/admin/school/invitations/:invitationId',
    {
      schema: {
        params: z.object({ invitationId: UuidSchema }),
        response: { 200: AdminSchoolInvitationRevokeResponseSchema }
      }
    },
    async (request, reply) => {
      const context = await requireAdmin(request, reply);
      if (!context) return;
      const { invitationId } = z.object({ invitationId: UuidSchema }).parse(request.params);
      const now = new Date();
      const [revoked] = await db
        .update(schoolInvitations)
        .set({ status: 'revoked', revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(schoolInvitations.id, invitationId),
            eq(schoolInvitations.schoolId, context.schoolId),
            eq(schoolInvitations.status, 'pending')
          )
        )
        .returning({ id: schoolInvitations.id });
      if (!revoked) {
        (reply as any).code(404);
        return { error: 'Pending school invitation not found', requestId: request.id };
      }
      await db
        .update(notifications)
        .set({ readAt: now })
        .where(
          and(
            eq(notifications.type, 'school_invitation'),
            eq(notifications.actionUrl, `/school?schoolInvitation=${invitationId}`),
            isNull(notifications.readAt)
          )
        );
      return { revoked: true };
    }
  );

  app.patch(
    '/v1/admin/members/:userId',
    {
      schema: {
        params: MemberParamsSchema,
        body: AdminMembershipStatusUpdateRequestSchema,
        response: { 200: AdminMembershipStatusUpdateResponseSchema }
      }
    },
    async (request, reply) => {
      const context = await requireAdmin(request, reply);
      if (!context) return;
      const { userId } = MemberParamsSchema.parse(request.params);
      const body = AdminMembershipStatusUpdateRequestSchema.parse(request.body);
      if (userId === context.userId) {
        (reply as any).code(400);
        return {
          error: 'You cannot change your own administrator membership here.',
          requestId: request.id
        };
      }
      const [membership] = await db
        .select({ role: schoolMemberships.role })
        .from(schoolMemberships)
        .where(
          and(
            eq(schoolMemberships.userId, userId),
            eq(schoolMemberships.schoolId, context.schoolId)
          )
        )
        .limit(1);
      if (!membership || membership.role !== 'teacher') {
        (reply as any).code(404);
        return { error: 'Teacher membership not found.', requestId: request.id };
      }
      const [updated] = await db
        .update(schoolMemberships)
        .set({ status: body.status, updatedAt: new Date() })
        .where(
          and(
            eq(schoolMemberships.userId, userId),
            eq(schoolMemberships.schoolId, context.schoolId),
            eq(schoolMemberships.role, 'teacher')
          )
        )
        .returning({
          userId: schoolMemberships.userId,
          schoolId: schoolMemberships.schoolId,
          status: schoolMemberships.status
        });
      if (!updated) throw new Error('Could not update school membership');
      return AdminMembershipStatusUpdateResponseSchema.parse(updated);
    }
  );

  app.post(
    '/v1/admin/claims',
    {
      schema: {
        body: AdminClaimRequestCreateSchema,
        response: { 200: AdminClaimRequestResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const body = AdminClaimRequestCreateSchema.parse(request.body);
      const [school] = await db
        .select({ id: schools.id, claimStatus: schools.claimStatus })
        .from(schools)
        .where(eq(schools.id, body.schoolId))
        .limit(1);
      if (!school) {
        (reply as any).code(404);
        return { error: 'School not found', requestId: request.id };
      }
      const access = await getSchoolAccess(user.id, school.id);
      if (!access || access.status !== 'active') {
        (reply as any).code(403);
        return {
          error: 'Join this school before requesting administrator access.',
          requestId: request.id
        };
      }
      if (school.claimStatus === 'claimed') {
        (reply as any).code(409);
        return { error: 'This school already has administrator access.', requestId: request.id };
      }
      const [existing] = await db
        .select({
          id: schoolClaimRequests.id,
          status: schoolClaimRequests.status,
          createdAt: schoolClaimRequests.createdAt
        })
        .from(schoolClaimRequests)
        .where(
          and(
            eq(schoolClaimRequests.schoolId, school.id),
            eq(schoolClaimRequests.requesterUserId, user.id),
            eq(schoolClaimRequests.status, 'pending')
          )
        )
        .limit(1);
      if (existing)
        return AdminClaimRequestResponseSchema.parse({
          ...existing,
          schoolId: school.id,
          createdAt: existing.createdAt.toISOString()
        });
      let claim:
        | { id: string; status: 'pending' | 'approved' | 'rejected'; createdAt: Date }
        | undefined;
      try {
        [claim] = await db
          .insert(schoolClaimRequests)
          .values({
            schoolId: school.id,
            requesterUserId: user.id,
            schoolEmail: body.schoolEmail,
            position: body.position,
            verificationNotes: body.verificationNotes ?? null
          })
          .returning({
            id: schoolClaimRequests.id,
            status: schoolClaimRequests.status,
            createdAt: schoolClaimRequests.createdAt
          });
      } catch (error) {
        if ((error as { code?: string }).code !== '23505') throw error;
        [claim] = await db
          .select({
            id: schoolClaimRequests.id,
            status: schoolClaimRequests.status,
            createdAt: schoolClaimRequests.createdAt
          })
          .from(schoolClaimRequests)
          .where(
            and(
              eq(schoolClaimRequests.schoolId, school.id),
              eq(schoolClaimRequests.requesterUserId, user.id),
              eq(schoolClaimRequests.status, 'pending')
            )
          )
          .limit(1);
      }
      if (!claim) throw new Error('Could not create school claim request');
      return AdminClaimRequestResponseSchema.parse({
        id: claim.id,
        schoolId: school.id,
        status: claim.status,
        createdAt: claim.createdAt.toISOString()
      });
    }
  );

  app.post(
    '/v1/admin/claims/:claimId/review',
    {
      schema: {
        params: ClaimParamsSchema,
        body: AdminClaimReviewRequestSchema,
        response: { 200: AdminClaimReviewResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const reviewer = await ensureUserFromPrincipal(principal);
      const { claimId } = ClaimParamsSchema.parse(request.params);
      const body = AdminClaimReviewRequestSchema.parse(request.body);
      const [claim] = await db
        .select({
          id: schoolClaimRequests.id,
          schoolId: schoolClaimRequests.schoolId,
          requesterUserId: schoolClaimRequests.requesterUserId,
          status: schoolClaimRequests.status,
          createdAt: schoolClaimRequests.createdAt
        })
        .from(schoolClaimRequests)
        .where(eq(schoolClaimRequests.id, claimId))
        .limit(1);
      if (!claim) {
        (reply as any).code(404);
        return { error: 'Claim request not found', requestId: request.id };
      }
      const reviewToken = request.headers['x-admin-claim-review-token'];
      const configuredReviewers = app.config.ADMIN_CLAIM_REVIEWER_EMAILS.split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);
      const hasReviewToken = Boolean(
        app.config.ADMIN_CLAIM_REVIEW_TOKEN &&
        reviewToken === app.config.ADMIN_CLAIM_REVIEW_TOKEN &&
        configuredReviewers.includes(reviewer.email.toLowerCase())
      );
      if (!hasReviewToken && !(await canAccessAdminWorkspace(reviewer.id, claim.schoolId))) {
        (reply as any).code(403);
        return { error: 'Administrator review access is required.', requestId: request.id };
      }
      const reviewedAt = new Date();
      await db.transaction(async (tx) => {
        // Claim reviews are serialized on the claim row first. The conditional
        // school update below then makes competing approvals fail atomically,
        // rather than allowing two reviewers to promote two administrators.
        const [lockedClaim] = await tx
          .update(schoolClaimRequests)
          .set({ updatedAt: reviewedAt })
          .where(
            and(eq(schoolClaimRequests.id, claim.id), eq(schoolClaimRequests.status, 'pending'))
          )
          .returning({ id: schoolClaimRequests.id });
        if (!lockedClaim) {
          const error = new Error('This claim request has already been reviewed.') as Error & {
            statusCode?: number;
          };
          error.statusCode = 409;
          throw error;
        }

        if (body.status === 'approved') {
          // Lock the membership row so a concurrent deactivation cannot race
          // this check and be silently undone by the approval upsert.
          const requesterMembership = await tx.execute(sql`
            SELECT status
            FROM school_memberships
            WHERE user_id = ${claim.requesterUserId}
              AND school_id = ${claim.schoolId}
            FOR UPDATE
          `);
          const requesterStatus = (requesterMembership.rows[0] as { status?: string } | undefined)
            ?.status;
          if (requesterStatus !== 'active') {
            const error = new Error(
              'The requester is no longer an active school member.'
            ) as Error & {
              statusCode?: number;
            };
            error.statusCode = 409;
            throw error;
          }
          const [claimedSchool] = await tx
            .update(schools)
            .set({
              claimStatus: 'claimed',
              claimedAt: reviewedAt,
              claimedByUserId: claim.requesterUserId,
              updatedAt: reviewedAt
            })
            .where(and(eq(schools.id, claim.schoolId), eq(schools.claimStatus, 'unclaimed')))
            .returning({ id: schools.id });
          if (!claimedSchool) {
            const error = new Error('This school already has administrator access.') as Error & {
              statusCode?: number;
            };
            error.statusCode = 409;
            throw error;
          }
        }

        await tx
          .update(schoolClaimRequests)
          .set({
            status: body.status,
            reviewNotes: body.reviewNotes ?? null,
            reviewedAt,
            reviewedByUserId: reviewer.id,
            updatedAt: reviewedAt
          })
          .where(eq(schoolClaimRequests.id, claim.id));
        if (body.status === 'approved') {
          await tx
            .insert(schoolMemberships)
            .values({
              userId: claim.requesterUserId,
              schoolId: claim.schoolId,
              role: 'admin',
              status: 'active',
              updatedAt: reviewedAt
            })
            .onConflictDoUpdate({
              target: [schoolMemberships.userId, schoolMemberships.schoolId],
              set: { role: 'admin', status: 'active', updatedAt: reviewedAt }
            });
          await tx
            .update(teacherProfiles)
            .set({ role: 'admin', updatedAt: reviewedAt })
            .where(
              and(
                eq(teacherProfiles.userId, claim.requesterUserId),
                eq(teacherProfiles.schoolId, claim.schoolId)
              )
            );
        }
      });
      return AdminClaimReviewResponseSchema.parse({
        id: claim.id,
        schoolId: claim.schoolId,
        status: body.status,
        createdAt: claim.createdAt.toISOString(),
        reviewedAt: reviewedAt.toISOString()
      });
    }
  );
}
