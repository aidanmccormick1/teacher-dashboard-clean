import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import type { MeetingInstancesResponse } from '@teacheros/contracts';
import { meetingOccursOn } from './weekly-meetings.js';
import { localDateFor } from './schedule-resolution.js';
import {
  courses,
  db,
  schoolCalendarEvents,
  schoolHolidays,
  schoolYears,
  sectionMeetingOverrides,
  sectionMeetings,
  sections
} from '@teacheros/db';

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

// A section can legitimately have two blocks on one day. The durable
// occurrence identity is the scheduled local start time, with `legacy` for
// imported date-only records and manual/untimed meetings.
function occurrenceKey(startTime: string | null | undefined) {
  return startTime?.slice(0, 5) || 'legacy';
}

export async function loadActiveSchoolYear(schoolId: string, timeZone = 'UTC') {
  const today = localDateFor(new Date(), timeZone);
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
  options: { sectionId?: string; startDate?: string; endDate?: string; timeZone?: string } = {}
): Promise<MeetingInstancesResponse> {
  const schoolYear = await loadActiveSchoolYear(schoolId, options.timeZone);
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
        isNull(courses.archivedAt),
        ...(options.sectionId ? [eq(sections.id, options.sectionId)] : [])
      )
    );

  const events = await db
    .select()
    .from(schoolCalendarEvents)
    .where(eq(schoolCalendarEvents.schoolYearId, schoolYear.id));
  // Legacy holidays are still written by older School flows. Treat them as
  // authoritative closures until all callers have migrated to calendar events.
  const legacyHolidays = await db
    .select({ date: schoolHolidays.date })
    .from(schoolHolidays)
    .where(eq(schoolHolidays.schoolId, schoolId));
  const legacyHolidayDates = new Set(legacyHolidays.map((holiday) => holiday.date));
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
    overrides.map((override) => [
      `${override.sectionId}:${override.date}:${override.occurrenceKey}`,
      override
    ])
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
  const emittedOccurrences = new Set<string>();
  const emittedSectionDates = new Set<string>();

  for (const row of sectionRows) {
    if (!row.day || /-day$/i.test(row.day)) continue;
    for (const day = new Date(first); day <= last; day.setUTCDate(day.getUTCDate() + 1)) {
      if (!meetingOccursOn(row.day, day)) continue;
      const date = isoDate(day);
      const calendarEvents = eventsByDate.get(date) ?? [];
      // A closure always wins when multiple calendar labels are recorded on a
      // date (for example, a named break and a staff-development label).
      const calendarEvent =
        calendarEvents.find((event) => event.type === 'no_school') ?? calendarEvents[0] ?? null;
      if (
        legacyHolidayDates.has(date) ||
        calendarEvents.some((event) => event.type === 'no_school')
      )
        continue;
      const rowOccurrenceKey = occurrenceKey(row.startTime);
      const override =
        overrideByKey.get(`${row.sectionId}:${date}:${rowOccurrenceKey}`) ??
        // Backward-compatible date-only overrides continue to affect every
        // pre-existing regular block for that section/date.
        overrideByKey.get(`${row.sectionId}:${date}:legacy`);
      // A special/minimum/testing day does not inherit the ordinary bell
      // schedule. We only create a real meeting when the calendar import (or
      // teacher) supplied a date-specific group override. This keeps the next
      // class calculation honest while still surfacing the calendar event.
      if (calendarEvents.length > 0 && !override) continue;
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
      emittedOccurrences.add(`${row.sectionId}:${date}:${rowOccurrenceKey}`);
      emittedSectionDates.add(`${row.sectionId}:${date}`);
    }
  }

  // An alternate schedule can put a group on a weekday it does not normally
  // meet. Treat that override as a dated meeting, but never duplicate a
  // regular occurrence that was already expanded for the same group and date.
  for (const override of overrides) {
    const key = `${override.sectionId}:${override.date}:${override.occurrenceKey}`;
    const dateKey = `${override.sectionId}:${override.date}`;
    if (
      emittedOccurrences.has(key) ||
      // A legacy override is a date-only compatibility record. Once a normal
      // block was emitted, it must not create a second phantom occurrence.
      (override.occurrenceKey === 'legacy' && emittedSectionDates.has(dateKey)) ||
      override.cancelled ||
      override.date < from ||
      override.date > to
    )
      continue;
    const section = sectionById.get(override.sectionId);
    if (!section) continue;
    const calendarEvents = eventsByDate.get(override.date) ?? [];
    if (
      legacyHolidayDates.has(override.date) ||
      calendarEvents.some((event) => event.type === 'no_school')
    )
      continue;
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
    emittedOccurrences.add(key);
    emittedSectionDates.add(dateKey);
  }

  output.sort((a, b) =>
    `${a.date}:${a.startTime ?? ''}`.localeCompare(`${b.date}:${b.startTime ?? ''}`)
  );
  return {
    meetings: output,
    schoolYear: { id: schoolYear.id, startDate: schoolYear.startDate, endDate: schoolYear.endDate }
  };
}
