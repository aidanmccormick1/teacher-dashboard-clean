import { describe, expect, it } from 'vitest';
import type { MeetingInstancesResponse } from '@teacheros/contracts';

import { projectMeetingsForSection } from './year-plan-projection.js';

const meetings: MeetingInstancesResponse = {
  schoolYear: null,
  meetings: [
    {
      sectionId: 'group-b',
      courseId: 'spanish-5',
      courseName: 'Spanish 5',
      sectionName: 'Group B',
      date: '2026-09-10',
      startTime: '10:00',
      endTime: '10:50',
      room: null,
      isAbnormal: false,
      calendarEvent: null
    },
    {
      sectionId: 'group-a',
      courseId: 'spanish-5',
      courseName: 'Spanish 5',
      sectionName: 'Group A',
      date: '2026-09-09',
      startTime: '09:00',
      endTime: '09:50',
      room: null,
      isAbnormal: false,
      calendarEvent: null
    },
    {
      sectionId: 'group-a',
      courseId: 'spanish-5',
      courseName: 'Spanish 5',
      sectionName: 'Group A',
      date: '2026-09-07',
      startTime: '09:00',
      endTime: '09:50',
      room: null,
      isAbnormal: false,
      calendarEvent: null
    },
    {
      sectionId: 'group-b',
      courseId: 'spanish-5',
      courseName: 'Spanish 5',
      sectionName: 'Group B',
      date: '2026-09-07',
      startTime: '10:00',
      endTime: '10:50',
      room: null,
      isAbnormal: false,
      calendarEvent: null
    }
  ]
};

describe('Year Plan Class Group date projection', () => {
  it('uses only Group A meeting dates in teaching order', () => {
    expect(projectMeetingsForSection(meetings, 'group-a').map((meeting) => meeting.date)).toEqual([
      '2026-09-07',
      '2026-09-09'
    ]);
  });

  it('switches to Group B without altering the shared meeting data', () => {
    expect(projectMeetingsForSection(meetings, 'group-b').map((meeting) => meeting.date)).toEqual([
      '2026-09-07',
      '2026-09-10'
    ]);
    expect(meetings.meetings).toHaveLength(4);
  });

  it('fails gracefully when no Class Group is selected', () => {
    expect(projectMeetingsForSection(meetings, null)).toEqual([]);
  });
});
