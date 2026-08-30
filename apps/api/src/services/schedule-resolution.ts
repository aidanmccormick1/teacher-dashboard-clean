import type { MeetingInstancesResponse } from '@teacheros/contracts';

const fallbackTimeZone = 'UTC';

export function validTimeZone(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return value;
  } catch {
    return null;
  }
}

export function localDateFor(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: validTimeZone(timeZone) ?? fallbackTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function localMinutesFor(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: validTimeZone(timeZone) ?? fallbackTimeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const part = (type: string) =>
    Number(parts.find((item) => item.type === type)?.value ?? Number.NaN);
  const hour = part('hour');
  const minute = part('minute');
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0;
}

export function timeToMinutes(time: string | null): number | null {
  if (!time) return null;
  const [hourText, minuteText] = time.slice(0, 5).split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}

type TodayMeeting = MeetingInstancesResponse['meetings'][number] & {
  isInSession: boolean;
  status: 'now' | 'upcoming' | 'completed' | 'unscheduled';
};

export function resolveTodayMeetings(
  meetings: MeetingInstancesResponse['meetings'],
  now: Date,
  timeZone: string
): {
  date: string;
  todaySchedule: TodayMeeting[];
  currentClass: TodayMeeting | null;
  nextClass: TodayMeeting | null;
} {
  const date = localDateFor(now, timeZone);
  const nowMinutes = localMinutesFor(now, timeZone);
  const todaySchedule = meetings
    .filter((meeting) => meeting.date === date)
    .map((meeting) => {
      const start = timeToMinutes(meeting.startTime);
      const end = timeToMinutes(meeting.endTime);
      const isInSession = start !== null && end !== null && nowMinutes >= start && nowMinutes < end;
      const status: TodayMeeting['status'] =
        start === null || end === null
          ? 'unscheduled'
          : isInSession
            ? 'now'
            : start > nowMinutes
              ? 'upcoming'
              : 'completed';
      return { ...meeting, isInSession, status };
    })
    .sort(
      (a, b) =>
        (timeToMinutes(a.startTime) ?? Number.MAX_SAFE_INTEGER) -
        (timeToMinutes(b.startTime) ?? Number.MAX_SAFE_INTEGER)
    );
  const currentClass = todaySchedule.find((meeting) => meeting.isInSession) ?? null;
  const nextClass =
    todaySchedule.find(
      (meeting) => (timeToMinutes(meeting.startTime) ?? Number.MAX_SAFE_INTEGER) > nowMinutes
    ) ?? null;
  return { date, todaySchedule, currentClass, nextClass };
}

export function resolveNextMeeting(
  meetings: MeetingInstancesResponse['meetings'],
  now: Date,
  timeZone: string
) {
  const date = localDateFor(now, timeZone);
  const minutes = localMinutesFor(now, timeZone);
  return (
    [...meetings]
      .sort((a, b) =>
        `${a.date}:${a.startTime ?? ''}`.localeCompare(`${b.date}:${b.startTime ?? ''}`)
      )
      .find(
        (meeting) =>
          meeting.date > date ||
          (meeting.date === date &&
            (timeToMinutes(meeting.startTime) ?? Number.MAX_SAFE_INTEGER) > minutes)
      ) ?? null
  );
}

export function resolvePreviousMeeting(
  meetings: MeetingInstancesResponse['meetings'],
  now: Date,
  timeZone: string
) {
  const date = localDateFor(now, timeZone);
  const minutes = localMinutesFor(now, timeZone);
  return (
    [...meetings]
      .sort((a, b) =>
        `${b.date}:${b.startTime ?? ''}`.localeCompare(`${a.date}:${a.startTime ?? ''}`)
      )
      .find(
        (meeting) =>
          meeting.date < date ||
          (meeting.date === date && (timeToMinutes(meeting.endTime) ?? -1) <= minutes)
      ) ?? null
  );
}
