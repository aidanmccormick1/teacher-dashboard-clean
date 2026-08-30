import { describe, expect, it } from 'vitest';
import { meetingOccursOn } from './weekly-meetings.js';

describe('section weekly meetings', () => {
  it('resolves arbitrary section patterns without assuming alternation', () => {
    const dates = ['2026-09-07', '2026-09-09', '2026-09-10', '2026-09-11'];
    const sectionsForDate = dates.map((iso) => {
      const date = new Date(`${iso}T12:00:00.000Z`);
      return [
        meetingOccursOn('Monday', date) || meetingOccursOn('Friday', date) ? 'Spanish 5B' : null,
        meetingOccursOn('Wednesday', date) || meetingOccursOn('Thursday', date)
          ? 'Spanish 5C'
          : null
      ].filter(Boolean);
    });
    expect(sectionsForDate).toEqual([
      ['Spanish 5B'],
      ['Spanish 5C'],
      ['Spanish 5C'],
      ['Spanish 5B']
    ]);
  });
});
