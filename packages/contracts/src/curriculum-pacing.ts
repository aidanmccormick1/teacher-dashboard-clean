type PacingUnit = {
  orderIndex: number;
  plannedStartMeeting: number | null;
  plannedMeetingCount: number | null;
  lessons: Array<{ estimatedDurationMinutes: number | null }>;
};

export function positionCurriculumUnits<Unit extends PacingUnit>(units: Unit[]) {
  let cursor = 0;
  return [...units]
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((unit) => {
      const estimated = unit.lessons.reduce(
        (count, lesson) =>
          count + Math.max(1, Math.ceil((lesson.estimatedDurationMinutes ?? 50) / 50)),
        0
      );
      const span = unit.plannedMeetingCount ?? (unit.lessons.length ? Math.max(2, estimated) : 1);
      const start = unit.plannedStartMeeting ?? cursor;
      cursor = Math.max(cursor, start + span);
      return { unit, start, span };
    });
}

export function reflowLessonRanges(start: number, span: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const offset = Math.floor((index * span) / count);
    const end = Math.floor(((index + 1) * span) / count);
    return { start: start + offset, span: Math.max(1, end - offset) };
  });
}
