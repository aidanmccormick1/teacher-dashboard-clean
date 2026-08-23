import { and, asc, eq, inArray } from 'drizzle-orm';

import type { MeetingInstancesResponse } from '@teacheros/contracts';
import {
  courses,
  db,
  schoolCalendarEvents,
  schoolYears,
  sectionMeetingOverrides,
  sectionMeetings,
  sections
} from '@teacheros/db';

const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function defaultEndTime(startTime: string | null) {
  if (!startTime) return null;
  const [hours, minutes] = startTime.slice(0, 5).split(':').map(Number);
  if (hours === undefined || minutes === undefined || Number.isNaN(hours) || Number.isNaN(minutes))
    return null;
  const end = hours * 60 + minutes + 55;
  return `${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}

export async function loadActiveSchoolYear(schoolId: string) {
  const today = isoDate(new Date());
  const all = await db
    .select()
    .from(schoolYears)
    .where(eq(schoolYears.schoolId, schoolId))
    .orderBy(asc(schoolYears.startDate));
  // Prefer the current range when an installation has historic years too.
  // If none is current, the newest configured year is the useful default for
  // teachers preparing an upcoming year.
  return all.find((year) => year.startDate <= today && year.endDate >= today) ?? all.at(-1) ?? null;
}

export async function buildMeetingInstances(
  userId: string,
  schoolId: string,
  options: { sectionId?: string; startDate?: string; endDate?: string } = {}
): Promise<MeetingInstancesResponse> {
  const schoolYear = await loadActiveSchoolYear(schoolId);
  if (!schoolYear) return { meetings: [], schoolYear: null };

  const sectionRows = await db
    .select({
      sectionId: sections.id,
      courseId: courses.id,
      courseName: courses.name,
      sectionName: sections.name,
      day: sectionMeetings.day,
      startTime: sectionMeetings.meetingTime,
      endTime: sectionMeetings.endTime,
      room: sectionMeetings.room
    })
    .from(sections)
    .innerJoin(courses, eq(sections.courseId, courses.id))
    .leftJoin(sectionMeetings, eq(sectionMeetings.sectionId, sections.id))
    .where(
      and(
        eq(courses.teacherId, userId),
        ...(options.sectionId ? [eq(sections.id, options.sectionId)] : [])
      )
    );

  const events = await db
    .select()
    .from(schoolCalendarEvents)
    .where(eq(schoolCalendarEvents.schoolYearId, schoolYear.id));
  const eventsByDate = new Map<string, typeof events>();
  for (const event of events) {
    const sameDateEvents = eventsByDate.get(event.date) ?? [];
    sameDateEvents.push(event);
    eventsByDate.set(event.date, sameDateEvents);
  }
  const sectionIds = [...new Set(sectionRows.map((row) => row.sectionId))];
  const overrides = sectionIds.length
    ? await db
        .select()
        .from(sectionMeetingOverrides)
        .where(inArray(sectionMeetingOverrides.sectionId, sectionIds))
    : [];
  const overrideByKey = new Map(
    overrides.map((override) => [`${override.sectionId}:${override.date}`, override])
  );
  const sectionById = new Map(
    sectionRows.map((row) => [
      row.sectionId,
      {
        courseId: row.courseId,
        courseName: row.courseName,
        sectionName: row.sectionName,
        room: row.room
      }
    ])
  );
  const from =
    options.startDate && options.startDate > schoolYear.startDate
      ? options.startDate
      : schoolYear.startDate;
  const to =
    options.endDate && options.endDate < schoolYear.endDate ? options.endDate : schoolYear.endDate;
  const first = new Date(`${from}T12:00:00.000Z`);
  const last = new Date(`${to}T12:00:00.000Z`);
  const output: MeetingInstancesResponse['meetings'] = [];
  const emittedSectionDates = new Set<string>();

  for (const row of sectionRows) {
    if (!row.day || /-day$/i.test(row.day)) continue;
    for (const day = new Date(first); day <= last; day.setUTCDate(day.getUTCDate() + 1)) {
      if (weekday[day.getUTCDay()] !== row.day) continue;
      const date = isoDate(day);
      const calendarEvents = eventsByDate.get(date) ?? [];
      // A closure always wins when multiple calendar labels are recorded on a
      // date (for example, a named break and a staff-development label).
      const calendarEvent =
        calendarEvents.find((event) => event.type === 'no_school') ?? calendarEvents[0] ?? null;
      if (calendarEvents.some((event) => event.type === 'no_school')) continue;
      const override = overrideByKey.get(`${row.sectionId}:${date}`);
      if (override?.cancelled) continue;
      output.push({
        sectionId: row.sectionId,
        courseId: row.courseId,
        courseName: row.courseName,
        sectionName: row.sectionName,
        date,
        startTime: override?.startTime?.slice(0, 5) ?? row.startTime?.slice(0, 5) ?? null,
        endTime:
          override?.endTime?.slice(0, 5) ??
          row.endTime?.slice(0, 5) ??
          defaultEndTime(row.startTime?.slice(0, 5) ?? null),
        room: override?.room ?? row.room,
        isAbnormal: calendarEvent !== null,
        calendarEvent: calendarEvent
          ? {
              id: calendarEvent.id,
              date: calendarEvent.date,
              type: calendarEvent.type,
              label: calendarEvent.label,
              confidence: calendarEvent.confidence,
              sourceText: calendarEvent.sourceText
            }
          : null
      });
      emittedSectionDates.add(`${row.sectionId}:${date}`);
    }
  }

  // An alternate schedule can put a group on a weekday it does not normally
  // meet. Treat that override as a dated meeting, but never duplicate a
  // regular occurrence that was already expanded for the same group and date.
  for (const override of overrides) {
    const key = `${override.sectionId}:${override.date}`;
    if (
      emittedSectionDates.has(key) ||
      override.cancelled ||
      override.date < from ||
      override.date > to
    )
      continue;
    const section = sectionById.get(override.sectionId);
    if (!section) continue;
    const calendarEvents = eventsByDate.get(override.date) ?? [];
    if (calendarEvents.some((event) => event.type === 'no_school')) continue;
    const calendarEvent = calendarEvents[0] ?? null;
    output.push({
      sectionId: override.sectionId,
      courseId: section.courseId,
      courseName: section.courseName,
      sectionName: section.sectionName,
      date: override.date,
      startTime: override.startTime?.slice(0, 5) ?? null,
      endTime:
        override.endTime?.slice(0, 5) ?? defaultEndTime(override.startTime?.slice(0, 5) ?? null),
      room: override.room ?? section.room,
      isAbnormal: true,
      calendarEvent: calendarEvent
        ? {
            id: calendarEvent.id,
            date: calendarEvent.date,
            type: calendarEvent.type,
            label: calendarEvent.label,
            confidence: calendarEvent.confidence,
            sourceText: calendarEvent.sourceText
          }
        : null
    });
  }

  output.sort((a, b) =>
    `${a.date}:${a.startTime ?? ''}`.localeCompare(`${b.date}:${b.startTime ?? ''}`)
  );
  return {
    meetings: output,
    schoolYear: { id: schoolYear.id, startDate: schoolYear.startDate, endDate: schoolYear.endDate }
  };
}
