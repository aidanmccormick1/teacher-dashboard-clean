import { describe, expect, it } from 'vitest';
import type { ClassroomResumeResponse, DashboardTodayResponse } from '@teacheros/contracts';

import {
  classroomPath,
  formatTime,
  lessonDisplay,
  nextClassroomLesson,
  priorityMeeting,
  timeRange
} from './today.js';

const today = {
  date: '2026-09-14',
  currentClass: null,
  nextClass: null,
  holiday: null,
  todaySchedule: [
    {
      sectionId: '11111111-1111-4111-8111-111111111111',
      courseName: 'Spanish 5',
      sectionName: '5B',
      meetingTime: '09:00',
      endTime: '09:50',
      room: null,
      isInSession: false,
      status: 'completed'
    },
    {
      sectionId: '22222222-2222-4222-8222-222222222222',
      courseName: 'Spanish 5',
      sectionName: '5C',
      meetingTime: '10:00',
      endTime: '10:50',
      room: null,
      isInSession: false,
      status: 'upcoming'
    }
  ]
} satisfies DashboardTodayResponse;

describe('Today helpers', () => {
  it('formats meeting times with AM/PM instead of 24-hour time', () => {
    expect(formatTime('08:00')).toBe('8 AM');
    expect(formatTime('20:00')).toBe('8 PM');
    expect(formatTime('13:35:00')).toBe('1:35 PM');
    expect(timeRange('08:00', '09:15')).toBe('8 AM – 9:15 AM');
  });

  it('prioritizes current, then next, from the centralized projection', () => {
    expect(priorityMeeting(today)?.sectionName).toBe('5C');
    expect(
      priorityMeeting({
        ...today,
        todaySchedule: [
          { ...today.todaySchedule[0]!, status: 'now' },
          ...today.todaySchedule.slice(1)
        ]
      })?.sectionName
    ).toBe('5B');
  });

  it('keeps a section unfinished lesson ahead of a different planned lesson', () => {
    const resume = {
      lesson: { id: 'lesson-8', title: 'Lesson 8', segments: [] },
      state: { status: 'stopped_at_segment', completedSegmentIds: [], stoppedAtSegmentId: null }
    } as unknown as ClassroomResumeResponse;
    expect(lessonDisplay(resume, { lessonId: 'lesson-9', title: 'Lesson 9' })).toMatchObject({
      isContinuation: true,
      differsFromPlan: true
    });
  });

  it('preserves the authoritative classroom meeting identity in links', () => {
    expect(classroomPath('section-id', '10:00')).toBe(
      '/classroom?section=section-id&meetingTime=10%3A00'
    );
  });

  it('advances to the next lesson in the same unit', () => {
    expect(
      nextClassroomLesson(
        { units: [{ lessons: [{ id: 'lesson-1' }, { id: 'lesson-2' }] }] },
        'lesson-1'
      )
    ).toEqual({ id: 'lesson-2' });
  });

  it('starts the next non-empty unit after the current unit ends', () => {
    expect(
      nextClassroomLesson(
        {
          units: [
            { lessons: [{ id: 'lesson-1' }] },
            { lessons: [] },
            { lessons: [{ id: 'lesson-3' }] }
          ]
        },
        'lesson-1'
      )
    ).toEqual({ id: 'lesson-3' });
  });

  it('returns no next lesson at the end of the course', () => {
    expect(nextClassroomLesson({ units: [{ lessons: [{ id: 'lesson-1' }] }] }, 'lesson-1')).toBe(
      null
    );
  });
});
