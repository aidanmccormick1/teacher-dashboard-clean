import type { MeetingInstancesResponse } from '@teacheros/contracts';

export function projectMeetingsForSection(
  meetingData: MeetingInstancesResponse | null,
  sectionId: string | null
): MeetingInstancesResponse['meetings'] {
  if (!meetingData || !sectionId) return [];
  return meetingData.meetings
    .filter((meeting) => meeting.sectionId === sectionId)
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        (left.startTime ?? '').localeCompare(right.startTime ?? '')
    );
}
