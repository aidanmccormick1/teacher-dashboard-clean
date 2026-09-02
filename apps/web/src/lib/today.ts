import type { ClassroomResumeResponse, DashboardTodayResponse } from '@teacheros/contracts';

export type TodayMeeting = DashboardTodayResponse['todaySchedule'][number];

export function classroomPath(sectionId: string, meetingTime: string | null): string {
  const query = new URLSearchParams({ section: sectionId });
  if (meetingTime) query.set('meetingTime', meetingTime);
  return `/classroom?${query.toString()}`;
}

export function priorityMeeting(today: DashboardTodayResponse | null): TodayMeeting | null {
  if (!today) return null;
  const current = today.todaySchedule.find((meeting) => meeting.status === 'now');
  if (current) return current;
  const next = today.todaySchedule.find((meeting) => meeting.status === 'upcoming');
  return next ?? null;
}

export function lessonProgress(resume: ClassroomResumeResponse | undefined) {
  const total = resume?.lesson?.segments.length ?? 0;
  const completed = resume?.state?.completedSegmentIds.length ?? 0;
  return { completed, total, percent: total ? Math.round((completed / total) * 100) : 0 };
}

export function lessonDisplay(
  resume: ClassroomResumeResponse | undefined,
  planned: { lessonId: string; title: string } | null
) {
  const actual = resume?.lesson ?? null;
  const unfinished = Boolean(
    actual &&
    resume?.state &&
    ['in_progress', 'stopped_at_segment', 'carried_over', 'needs_reteach'].includes(
      resume.state.status
    )
  );
  return {
    actual,
    planned,
    isContinuation: unfinished,
    differsFromPlan: Boolean(actual && planned && actual.id !== planned.lessonId)
  };
}

export function formatTime(value: string | null): string {
  if (!value) return 'Time TBD';
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return value;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return value;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''} ${period}`;
}

export function timeRange(start: string | null, end: string | null): string {
  if (!start) return 'Time TBD';
  return `${formatTime(start)} – ${end ? formatTime(end) : 'end TBD'}`;
}
