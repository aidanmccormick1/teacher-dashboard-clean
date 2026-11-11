export function distributeUnitPeriods(start: number, periodCount: number, lessonCount: number) {
  if (lessonCount < 1) return [];
  if (lessonCount > periodCount) {
    return Array.from({ length: lessonCount }, (_, index) => ({
      start: start + Math.floor((index * periodCount) / lessonCount),
      span: 1
    }));
  }
  const base = Math.floor(periodCount / lessonCount);
  const remainder = periodCount % lessonCount;
  let cursor = start;
  return Array.from({ length: lessonCount }, (_, index) => {
    const span = Math.max(1, base + (index < remainder ? 1 : 0));
    const range = { start: cursor, span };
    cursor += span;
    return range;
  });
}
