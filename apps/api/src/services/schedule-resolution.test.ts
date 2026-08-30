import { describe, expect, it } from 'vitest';
import {
  localDateFor,
  resolveNextMeeting,
  resolvePreviousMeeting,
  resolveTodayMeetings,
  validTimeZone
} from './schedule-resolution.js';

const meeting = (sectionId: string, date: string, startTime: string, endTime: string) => ({
  sectionId,
  courseId: '00000000-0000-4000-8000-000000000001',
  courseName: 'Spanish 7',
  sectionName: sectionId,
  date,
  startTime,
  endTime,
  room: null,
  isAbnormal: false,
  calendarEvent: null
});

describe('schedule resolution', () => {
  it('resolves current and next sections in the school timezone', () => {
    const now = new Date('2026-09-08T17:35:00.000Z'); // Tuesday, 10:35 AM Los Angeles
    const result = resolveTodayMeetings(
      [
        meeting('Spanish 7C', '2026-09-08', '10:20', '11:10'),
        meeting('Spanish 8A', '2026-09-08', '13:15', '14:05')
      ],
      now,
      'America/Los_Angeles'
    );
    expect(result.date).toBe('2026-09-08');
    expect(result.currentClass?.sectionId).toBe('Spanish 7C');
    expect(result.nextClass?.sectionId).toBe('Spanish 8A');
    expect(
      resolveNextMeeting(
        [
          meeting('Spanish 7C', '2026-09-10', '10:20', '11:10'),
          meeting('Spanish 8A', '2026-09-08', '13:15', '14:05')
        ],
        now,
        'America/Los_Angeles'
      )?.sectionId
    ).toBe('Spanish 8A');
    expect(
      resolvePreviousMeeting(
        [meeting('Spanish 7C', '2026-09-08', '08:00', '09:00')],
        now,
        'America/Los_Angeles'
      )?.sectionId
    ).toBe('Spanish 7C');
  });

  it('uses local calendar dates instead of UTC dates', () => {
    expect(localDateFor(new Date('2026-09-09T06:30:00.000Z'), 'America/Los_Angeles')).toBe(
      '2026-09-08'
    );
    expect(validTimeZone('America/Los_Angeles')).toBe('America/Los_Angeles');
    expect(validTimeZone('not/a-zone')).toBeNull();
  });

  it('keeps a Tuesday/Thursday section on its actual weekly meeting pattern', () => {
    const tuesdayDuringClass = new Date('2026-09-08T17:35:00.000Z');
    const meetings = [
      meeting('Group C', '2026-09-08', '10:20', '11:10'),
      meeting('Group C', '2026-09-10', '10:20', '11:10')
    ];

    expect(resolveTodayMeetings(meetings, tuesdayDuringClass, 'America/Los_Angeles').currentClass)
      .toMatchObject({ sectionId: 'Group C', date: '2026-09-08' });
    expect(resolveNextMeeting(meetings, new Date('2026-09-08T19:00:00.000Z'), 'America/Los_Angeles'))
      .toMatchObject({ sectionId: 'Group C', date: '2026-09-10' });
  });
});
