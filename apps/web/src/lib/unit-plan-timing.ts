import type { GetScheduleResponse, MeetingInstancesResponse } from '@teacheros/contracts';
import { sortCourseMeetings } from './courseSchedule.js';
import { projectMeetingsForSection } from './year-plan-projection.js';

type Section = GetScheduleResponse['sections'][number];

function duration(start: string | null, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const toMinutes = (time: string) => {
    if (!/^\d{2}:\d{2}$/.test(time)) return NaN;
    const [hours, minutes] = time.split(':').map(Number);
    return hours! < 24 && minutes! < 60 ? hours! * 60 + minutes! : NaN;
  };
  const minutes = toMinutes(end) - toMinutes(start);
  return Number.isInteger(minutes) && minutes > 0 ? minutes : null;
}

export function unitPlanTiming({
  courseId,
  selectedSection,
  sections,
  meetingData,
  startMeeting,
  meetingCount
}: {
  courseId: string;
  selectedSection: Section | null;
  sections: Section[];
  meetingData: MeetingInstancesResponse | null;
  startMeeting: number;
  meetingCount: number;
}): { minutes: number[]; source: string | null; issue: string | null } {
  const courseSections = sections.filter((section) => section.courseId === courseId);
  const selected = selectedSection?.courseId === courseId ? selectedSection : null;
  const section = selected ?? (courseSections.length === 1 ? courseSections[0] : null);
  if (!section && courseSections.length > 1) {
    const lengths = courseSections.flatMap((group) =>
      group.meetings.map((meeting) => duration(meeting.time, meeting.endTime))
    );
    if (
      courseSections.every((group) => group.meetings.length) &&
      lengths.every((length) => length !== null) &&
      new Set(lengths).size === 1
    ) {
      return {
        minutes: Array.from({ length: meetingCount }, () => lengths[0]!),
        source: 'your course’s Class Groups',
        issue: null
      };
    }
    return {
      minutes: [],
      source: null,
      issue: 'Choose a Class Group to use its schedule, or enter a period length below.'
    };
  }
  if (!section?.meetings.length) {
    return {
      minutes: [],
      source: null,
      issue: 'Add class start and end times to the schedule, or enter a period length below.'
    };
  }
  const recurring = sortCourseMeetings(section.meetings).map((meeting) =>
    duration(meeting.time, meeting.endTime)
  );
  if (recurring.some((minutes) => minutes === null)) {
    return {
      minutes: [],
      source: null,
      issue:
        'Some class meetings have no length set. Add their start and end times, or enter a period length below.'
    };
  }
  const projected = projectMeetingsForSection(meetingData, section.sectionId);
  const minutes = Array.from({ length: meetingCount }, (_, index) => {
    const meetingIndex = startMeeting + index;
    const meeting = projected[meetingIndex];
    if (meeting) return duration(meeting.startTime, meeting.endTime);
    // Continue the recurring pattern after the last dated meeting, preserving
    // its weekday and block when the school calendar ends midweek.
    const last = projected.at(-1);
    const lastDay = last && new Date(`${last.date}T12:00:00Z`).getUTCDay();
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const ordered = sortCourseMeetings(section.meetings);
    const lastIndex = last
      ? ordered.findIndex((item) => item.day === weekdays[lastDay!] && item.time === last.startTime)
      : -1;
    const offset = lastIndex >= 0 ? lastIndex + 1 + meetingIndex - projected.length : meetingIndex;
    return recurring[offset % recurring.length]!;
  });
  if (minutes.some((value) => value === null)) {
    return {
      minutes: [],
      source: null,
      issue:
        'A planned period has no length set. Update its schedule, or enter a period length below.'
    };
  }
  return { minutes: minutes as number[], source: section.sectionName, issue: null };
}
