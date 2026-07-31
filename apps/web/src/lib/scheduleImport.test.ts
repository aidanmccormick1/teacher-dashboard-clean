import { describe, expect, it } from 'vitest';
import type { ParseScheduleResponse } from '@teacheros/contracts';

import { normalizeImportedCourseVariants } from './scheduleImport.js';

const baseClass: Omit<ParseScheduleResponse['classes'][number], 'name' | 'period'> = {
  days: ['Monday'],
  time: '08:10',
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

  it('keeps repeated class-group labels together while preserving their meeting occurrences', () => {
    const result = normalizeImportedCourseVariants({
      classes: [
        { ...baseClass, name: 'Spanish 5', period: 'Group B / Period 1', days: ['Monday'], time: '08:10' },
        { ...baseClass, name: 'Spanish 5', period: 'Group B / Period 5', days: ['Thursday'], time: '13:35' }
      ],
      assignments: []
    });

    expect(result.classes.map(({ name, period, days, time }) => ({ name, period, days, time }))).toEqual([
      { name: 'Spanish 5', period: 'Group B', days: ['Monday'], time: '08:10' },
      { name: 'Spanish 5', period: 'Group B', days: ['Thursday'], time: '13:35' }
    ]);
  });
});
