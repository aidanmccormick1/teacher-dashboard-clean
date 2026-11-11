import { describe, expect, it } from 'vitest';
import type { GetScheduleResponse, MeetingInstancesResponse } from '@teacheros/contracts';
import { unitPlanTiming } from './unit-plan-timing.js';

type Section = GetScheduleResponse['sections'][number];
const fifth: Section = {
  sectionId: 'fifth',
  courseId: 'grade-5',
  courseName: 'Grade 5',
  sectionName: '5A',
  originalScheduleLabel: null,
  meetings: ['Monday', 'Thursday'].map((day) => ({
    day: day as 'Monday' | 'Thursday',
    time: '09:00',
    endTime: '09:35',
    room: null
  }))
};
const sixth: Section = {
  ...fifth,
  sectionId: 'sixth',
  courseId: 'grade-6',
  sectionName: '6A',
  meetings: [{ day: 'Tuesday', time: '10:00', endTime: '10:50', room: null }]
};
const base = {
  courseId: fifth.courseId,
  sections: [fifth, sixth],
  selectedSection: null,
  meetingData: null,
  startMeeting: 0,
  meetingCount: 4
};
function instance(date: string, endTime: string): MeetingInstancesResponse['meetings'][number] {
  return {
    sectionId: fifth.sectionId,
    courseId: fifth.courseId,
    courseName: fifth.courseName,
    sectionName: fifth.sectionName,
    date,
    startTime: '09:00',
    endTime,
    room: null,
    isAbnormal: false,
    calendarEvent: null
  };
}

describe('unit plan period timing', () => {
  it('automatically uses the course schedule: four fifth-grade periods total 140 minutes', () => {
    const timing = unitPlanTiming(base);
    expect(timing.minutes).toEqual([35, 35, 35, 35]);
    expect(timing.minutes.reduce((sum, minutes) => sum + minutes, 0)).toBe(140);
    expect(timing.source).toBe('5A');
  });
  it('uses sixth-grade periods without borrowing from another course or a stale selection', () => {
    expect(
      unitPlanTiming({ ...base, courseId: sixth.courseId, selectedSection: fifth }).minutes
    ).toEqual([50, 50, 50, 50]);
  });
  it('uses the actual periods after existing units, including a shortened day and two same-day blocks', () => {
    const data: MeetingInstancesResponse = {
      schoolYear: null,
      meetings: [
        instance('2026-09-07', '09:35'),
        instance('2026-09-10', '09:35'),
        instance('2026-09-14', '09:25'),
        { ...instance('2026-09-14', '10:20'), startTime: '09:45' },
        instance('2026-09-17', '09:35'),
        instance('2026-09-21', '09:35')
      ]
    };
    expect(unitPlanTiming({ ...base, startMeeting: 2, meetingData: data }).minutes).toEqual([
      25, 35, 35, 35
    ]);
  });
  it('preserves mixed recurring period lengths and their offset without a dated calendar', () => {
    const mixed = {
      ...fifth,
      meetings: [fifth.meetings[0]!, { ...fifth.meetings[1]!, endTime: '09:50' }]
    };
    expect(unitPlanTiming({ ...base, sections: [mixed], startMeeting: 1 }).minutes).toEqual([
      50, 35, 50, 35
    ]);
  });
  it('continues after a calendar ending midweek from the next recurring block', () => {
    const mixed = {
      ...fifth,
      meetings: [fifth.meetings[0]!, { ...fifth.meetings[1]!, endTime: '09:50' }]
    };
    expect(
      unitPlanTiming({
        ...base,
        sections: [mixed],
        startMeeting: 1,
        meetingData: { schoolYear: null, meetings: [instance('2026-09-10', '09:50')] }
      }).minutes
    ).toEqual([35, 50, 35, 50]);
  });
  it('uses a shared duration across course groups, but requires a choice for different lengths', () => {
    const another = { ...fifth, sectionId: '5b', sectionName: '5B' };
    expect(unitPlanTiming({ ...base, sections: [fifth, another] }).minutes).toEqual([
      35, 35, 35, 35
    ]);
    const different = { ...another, meetings: sixth.meetings };
    expect(unitPlanTiming({ ...base, sections: [fifth, different] }).issue).toContain(
      'Choose a Class Group'
    );
    expect(
      unitPlanTiming({ ...base, sections: [fifth, different], selectedSection: different }).minutes
    ).toEqual([50, 50, 50, 50]);
  });
  it('requires a length for incomplete, invalid, or absent schedules instead of assuming 50 minutes', () => {
    for (const meetings of [
      [],
      [{ ...fifth.meetings[0]!, endTime: null }],
      [{ ...fifth.meetings[0]!, endTime: '08:50' }],
      [{ ...fifth.meetings[0]!, endTime: '09:99' }]
    ]) {
      const result = unitPlanTiming({ ...base, sections: [{ ...fifth, meetings }] });
      expect(result.minutes).toEqual([]);
      expect(result.issue).toBeTruthy();
    }
  });
  it('uses rotation blocks in schedule order', () => {
    const rotating = {
      ...fifth,
      meetings: [
        { ...fifth.meetings[0]!, day: 'B-Day' as const, endTime: '09:50' },
        { ...fifth.meetings[0]!, day: 'A-Day' as const }
      ]
    };
    expect(unitPlanTiming({ ...base, sections: [rotating] }).minutes).toEqual([35, 50, 35, 50]);
  });
});
