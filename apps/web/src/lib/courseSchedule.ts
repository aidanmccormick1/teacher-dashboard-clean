import { MeetingDaySchema } from '@teacheros/contracts';

export const meetingDays = MeetingDaySchema.options;

type Meeting = { day: string; time: string | null; endTime?: string | null };

export function sortCourseMeetings<T extends Meeting>(meetings: readonly T[]): T[] {
  const dayRank = (day: string) => {
    const index = meetingDays.findIndex((candidate) => candidate === day);
    return index < 0 ? meetingDays.length : index;
  };
  return [...meetings].sort(
    (a, b) =>
      dayRank(a.day) - dayRank(b.day) ||
      (a.time ?? '99:99').localeCompare(b.time ?? '99:99') ||
      (a.endTime ?? '99:99').localeCompare(b.endTime ?? '99:99')
  );
}
