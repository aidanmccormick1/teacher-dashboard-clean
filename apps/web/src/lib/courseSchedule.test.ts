import { describe, expect, it } from 'vitest';
import { sortCourseMeetings } from './courseSchedule.js';

describe('sortCourseMeetings', () => {
  it('orders weekdays before rotation days without mutating the schedule', () => {
    const meetings = [
      { day: 'Tuesday', time: '08:00' },
      { day: 'B-Day', time: '08:00' },
      { day: 'Friday', time: '08:00' },
      { day: 'Monday', time: '09:00' },
      { day: 'A-Day', time: '08:00' }
    ];
    expect(sortCourseMeetings(meetings).map((meeting) => meeting.day)).toEqual([
      'Monday',
      'Tuesday',
      'Friday',
      'A-Day',
      'B-Day'
    ]);
    expect(meetings[0]?.day).toBe('Tuesday');
  });

  it('orders same-day meetings by time and keeps unscheduled meetings last', () => {
    expect(
      sortCourseMeetings([
        { day: 'Monday', time: null },
        { day: 'Monday', time: '14:00' },
        { day: 'Monday', time: '08:00' }
      ]).map((meeting) => meeting.time)
    ).toEqual(['08:00', '14:00', null]);
  });
});
