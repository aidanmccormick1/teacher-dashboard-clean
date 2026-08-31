import { describe, expect, it } from 'vitest';

import { normalizePlanningRange } from './year-plan-range.js';

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
});
