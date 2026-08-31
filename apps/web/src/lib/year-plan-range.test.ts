import { describe, expect, it } from 'vitest';

import {
  normalizePlanningRange,
  planningRangeIntersects,
  planningRangeLabel
} from './year-plan-range.js';

const meetings = [
  { date: '2026-09-07' },
  { date: '2026-09-09' },
  { date: '2026-09-11' },
  { date: '2026-09-14' }
] as never;

describe('normalizePlanningRange', () => {
  it('normalizes either drag direction over effective meetings', () => {
    expect(normalizePlanningRange(3, 1, meetings)).toEqual({
      start: 1,
      end: 3,
      meetingCount: 3
    });
  });

  it('clamps to valid effective meeting boundaries', () => {
    expect(normalizePlanningRange(-8, 99, meetings)).toEqual({
      start: 0,
      end: 3,
      meetingCount: 4
    });
  });

  it('does not create a range without effective meetings', () => {
    expect(normalizePlanningRange(0, 1, [])).toBeNull();
  });

  it('supports course-level planning when no section date preview is selected', () => {
    const courseMeetings = Array.from({ length: 8 }, () => ({}));
    const range = normalizePlanningRange(5, 2, courseMeetings);

    expect(range).toEqual({ start: 2, end: 5, meetingCount: 4 });
    expect(planningRangeLabel(range!, courseMeetings)).toBe('Meetings 3–6 · 4 meetings');
  });

  it('detects conflicts without treating adjacent planned ranges as overlaps', () => {
    const planned = [{ start: 3, meetingCount: 2 }];

    expect(planningRangeIntersects({ start: 1, meetingCount: 2 }, planned)).toBe(false);
    expect(planningRangeIntersects({ start: 2, meetingCount: 2 }, planned)).toBe(true);
    expect(planningRangeIntersects({ start: 5, meetingCount: 2 }, planned)).toBe(false);
  });
});
