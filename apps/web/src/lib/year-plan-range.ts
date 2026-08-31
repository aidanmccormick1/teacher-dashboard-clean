export type PlanningRange = {
  start: number;
  end: number;
  meetingCount: number;
};

type PlannedSpan = Pick<PlanningRange, 'start' | 'meetingCount'>;
type RangeMeeting = { date?: string };

/**
 * A drag-create range is additive: it may never silently write over an
 * existing planned unit. This comparison deliberately operates on meeting
 * indexes, after the schedule service has already resolved real dates.
 */
export function planningRangeIntersects(range: PlannedSpan, planned: PlannedSpan[]): boolean {
  return planned.some(
    (item) =>
      range.start < item.start + item.meetingCount && item.start < range.start + range.meetingCount
  );
}

/**
 * Convert a pointer selection into an inclusive range of already-resolved
 * meeting instances. Calendar days never enter this calculation: closures,
 * cancellations, overrides, and irregular schedules have already been
 * applied by the schedule service that produced the meeting list.
 */
export function normalizePlanningRange(
  firstIndex: number,
  lastIndex: number,
  meetings: RangeMeeting[]
): PlanningRange | null {
  if (!meetings.length || !Number.isFinite(firstIndex) || !Number.isFinite(lastIndex)) {
    return null;
  }
  const lower = Math.min(firstIndex, lastIndex);
  const upper = Math.max(firstIndex, lastIndex);
  const start = Math.max(0, Math.min(meetings.length - 1, Math.round(lower)));
  const end = Math.max(0, Math.min(meetings.length - 1, Math.round(upper)));
  if (end < start) return null;
  return { start, end, meetingCount: end - start + 1 };
}

export function planningRangeLabel(
  range: PlanningRange,
  meetings: RangeMeeting[],
  locale?: string
): string {
  const first = meetings[range.start];
  const last = meetings[range.end];
  if (!first || !last) return `${range.meetingCount} meetings`;
  if (!first.date || !last.date) {
    return `Meetings ${range.start + 1}–${range.end + 1} · ${range.meetingCount} ${
      range.meetingCount === 1 ? 'meeting' : 'meetings'
    }`;
  }
  const format = (date: string) =>
    new Date(`${date}T12:00:00`).toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric'
    });
  return `${format(first.date)} – ${format(last.date)} · ${range.meetingCount} ${
    range.meetingCount === 1 ? 'meeting' : 'meetings'
  }`;
}
