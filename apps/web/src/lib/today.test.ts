import { describe, expect, it } from 'vitest';
import type { ClassroomResumeResponse, DashboardTodayResponse } from '@teacheros/contracts';

import { classroomPath, lessonDisplay, priorityMeeting } from './today.js';

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
});
