import { describe, expect, it } from 'vitest';

import {
  CalendarCommitRequestSchema,
  CalendarImportResponseSchema,
  CalendarEventTypeSchema,
  SectionMeetingOverrideRequestSchema,
  SchoolYearUpsertRequestSchema
} from './index.js';

describe('school calendar contracts', () => {
  it('accepts typed cross-year calendar events and group-specific alternate schedules', () => {
    const parsed = CalendarImportResponseSchema.parse({
      schoolYear: { startDate: '2026-08-17', endDate: '2027-06-04' },
      events: [
        { date: '2026-12-21', type: 'no_school', label: 'Winter break begins', confidence: 98 },
        { date: '2027-01-04', type: 'no_school', label: 'Winter break ends', confidence: 98 },
        { date: '2027-02-12', type: 'minimum_day', label: 'Staff development', confidence: 91 }
      ],
      overrides: [
        {
          date: '2027-02-12',
          classGroup: 'Group B',
          startTime: '09:15',
          endTime: '09:50',
          room: '104'
        }
      ],
      notices: []
    });

    expect(parsed.events.map((event) => event.type)).toEqual([
      'no_school',
      'no_school',
      'minimum_day'
    ]);
    expect(parsed.overrides[0]).toMatchObject({ classGroup: 'Group B', cancelled: false });
  });

  it('only allows the supported calendar types and valid school-year ranges', () => {
    expect(CalendarEventTypeSchema.safeParse('special_schedule').success).toBe(true);
    expect(CalendarEventTypeSchema.safeParse('snow_day').success).toBe(false);
    expect(
      SchoolYearUpsertRequestSchema.safeParse({ startDate: '2027-06-04', endDate: '2026-08-17' })
        .success
    ).toBe(false);
  });

  it('requires valid meeting overrides and explicit merge/replace decisions', () => {
    expect(
      SectionMeetingOverrideRequestSchema.safeParse({
        date: '2026-09-10',
        startTime: '12:00',
        endTime: '11:55',
        room: null,
        cancelled: false
      }).success
    ).toBe(false);

    expect(
      CalendarCommitRequestSchema.safeParse({
        mode: 'merge',
        schoolYear: { startDate: '2026-08-17', endDate: '2027-06-04' },
        events: [{ date: '2026-11-11', type: 'no_school', label: 'Veterans Day' }],
        approvedEventKeys: ['2026-11-11:no_school']
      }).success
    ).toBe(true);
  });
});
