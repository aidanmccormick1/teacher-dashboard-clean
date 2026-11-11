import { describe, expect, it } from 'vitest';
import { distributeUnitPeriods } from './unit-plan-layout.js';

describe('unit draft preview and saved timeline placement', () => {
  it('appends four lessons after an existing four-period unit', () => {
    expect(distributeUnitPeriods(4, 4, 4)).toEqual([
      { start: 4, span: 1 },
      { start: 5, span: 1 },
      { start: 6, span: 1 },
      { start: 7, span: 1 }
    ]);
  });
  it('keeps the full unit range when the teacher removes a lesson', () => {
    const ranges = distributeUnitPeriods(4, 4, 3);
    expect(ranges).toEqual([
      { start: 4, span: 2 },
      { start: 6, span: 1 },
      { start: 7, span: 1 }
    ]);
    expect(ranges.reduce((sum, range) => sum + range.span, 0)).toBe(4);
  });
  it('handles an empty edited idea and existing drafts with multiple lessons per period', () => {
    expect(distributeUnitPeriods(0, 4, 0)).toEqual([]);
    expect(distributeUnitPeriods(4, 2, 3)).toEqual([
      { start: 4, span: 1 },
      { start: 4, span: 1 },
      { start: 5, span: 1 }
    ]);
  });
});
