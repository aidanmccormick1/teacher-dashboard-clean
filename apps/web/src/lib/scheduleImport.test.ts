import { describe, expect, it } from 'vitest';
import type { ParseScheduleResponse } from '@teacheros/contracts';

import { normalizeImportedCourseVariants } from './scheduleImport.js';

const baseClass: Omit<ParseScheduleResponse['classes'][number], 'name' | 'period'> = {
  days: ['Monday'],
  time: '08:10',
  endTime: '09:05',
  room: '101',
  subject: 'Mathematics',
  grade: ''
};

describe('normalizeImportedCourseVariants', () => {
  it('groups letter-suffixed classes under one numbered course', () => {
    const result = normalizeImportedCourseVariants({
      classes: [
        { ...baseClass, name: 'Spanish 5A', period: '1' },
        { ...baseClass, name: 'Spanish 5 B', period: '3' },
        { ...baseClass, name: 'Spanish 5 - C', period: '5' }
      ],
      assignments: [{ name: 'Quiz', courseName: 'Spanish 5B', dueDate: null, description: null }]
    });

    expect(result.classes.map(({ name, period }) => ({ name, period }))).toEqual([
      { name: 'Spanish 5', period: 'Group A' },
      { name: 'Spanish 5', period: 'Group B' },
      { name: 'Spanish 5', period: 'Group C' }
    ]);
    expect(result.assignments[0]?.courseName).toBe('Spanish 5');
  });

  it('groups block labels under a shared non-numbered course', () => {
    const result = normalizeImportedCourseVariants({
      classes: [
        { ...baseClass, name: 'Pre-Calculus Block 1', period: 'Block 1' },
        { ...baseClass, name: 'Pre-Calculus, Block 3', period: '3' },
        { ...baseClass, name: 'Pre-Calculus block 4', period: '4' }
      ],
      assignments: []
    });

    expect(result.classes.map(({ name, period }) => ({ name, period }))).toEqual([
      { name: 'Pre-Calculus', period: 'Block 1' },
      { name: 'Pre-Calculus', period: 'Block 3' },
      { name: 'Pre-Calculus', period: 'Block 4' }
    ]);
  });

  it('groups AP letter sections under their shared course', () => {
    const result = normalizeImportedCourseVariants({
      classes: [
        { ...baseClass, name: 'AP Government A', period: '1' },
        { ...baseClass, name: 'AP Government B', period: '2' }
      ],
      assignments: []
    });
    expect(result.classes.map(({ name, period }) => ({ name, period }))).toEqual([
      { name: 'AP Government', period: 'Group A' },
      { name: 'AP Government', period: 'Group B' }
    ]);
  });

  it('keeps numbered period groups under their shared course', () => {
    const result = normalizeImportedCourseVariants({
      classes: [
        { ...baseClass, name: 'Math 6 Period 1', period: '1' },
        { ...baseClass, name: 'Math 6 Period 4', period: '4' },
        { ...baseClass, name: 'AP Government Period 1', period: '1' }
      ],
      assignments: []
    });

    expect(result.classes.map(({ name, period }) => ({ name, period }))).toEqual([
      { name: 'Math 6', period: 'Period 1' },
      { name: 'Math 6', period: 'Period 4' },
      { name: 'AP Government', period: 'Period 1' }
    ]);
  });

  it('normalizes contextual shorthand alongside the full course title', () => {
    const result = normalizeImportedCourseVariants({
      classes: [
        { ...baseClass, name: 'Spanish 7', period: 'Group A' },
        { ...baseClass, name: '7B Spanish', period: '2' },
        { ...baseClass, name: '7C Spanish', period: '3' }
      ],
      assignments: [{ name: 'Quiz', courseName: '7B Spanish', dueDate: null, description: null }]
    });

    expect(result.classes.map(({ name, period }) => ({ name, period }))).toEqual([
      { name: 'Spanish 7', period: 'Group A' },
      { name: 'Spanish 7', period: 'Group B' },
      { name: 'Spanish 7', period: 'Group C' }
    ]);
    expect(result.assignments[0]?.courseName).toBe('Spanish 7');
  });

  it('keeps repeated class-group labels together while preserving their meeting occurrences', () => {
    const result = normalizeImportedCourseVariants({
      classes: [
        {
          ...baseClass,
          name: 'Spanish 5',
          period: 'Group B / Period 1',
          days: ['Monday'],
          time: '08:10'
        },
        {
          ...baseClass,
          name: 'Spanish 5',
          period: 'Group B / Period 5',
          days: ['Thursday'],
          time: '13:35'
        }
      ],
      assignments: []
    });

    expect(
      result.classes.map(({ name, period, days, time }) => ({ name, period, days, time }))
    ).toEqual([
      { name: 'Spanish 5', period: 'Group B', days: ['Monday'], time: '08:10' },
      { name: 'Spanish 5', period: 'Group B', days: ['Thursday'], time: '13:35' }
    ]);
  });

  it('normalizes grid shorthand written before the subject', () => {
    const result = normalizeImportedCourseVariants({
      classes: [
        { ...baseClass, name: '5A Spanish', period: '4' },
        { ...baseClass, name: '5B Spanish', period: '1' },
        { ...baseClass, name: '8B Spanish', period: '3/4' }
      ],
      assignments: []
    });

    expect(result.classes.map(({ name, period }) => ({ name, period }))).toEqual([
      { name: 'Spanish 5', period: 'Group A' },
      { name: 'Spanish 5', period: 'Group B' },
      { name: 'Spanish 8', period: 'Group B' }
    ]);
  });

  it('removes duplicate meeting records returned by a visual audit', () => {
    const result = normalizeImportedCourseVariants({
      classes: [
        {
          ...baseClass,
          name: 'Spanish 8B',
          period: '3',
          days: ['Thursday'],
          time: '10:08',
          room: 'Jones HR'
        },
        {
          ...baseClass,
          name: 'Spanish 8B',
          period: '4',
          days: ['Thursday'],
          time: '10:08',
          room: 'Jones HR'
        }
      ],
      assignments: []
    });

    expect(result.classes).toHaveLength(1);
    expect(result.classes[0]).toMatchObject({
      name: 'Spanish 8',
      period: 'Group B',
      days: ['Thursday'],
      time: '10:08'
    });
  });
});
