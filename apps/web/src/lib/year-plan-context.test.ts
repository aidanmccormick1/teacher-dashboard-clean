import { describe, expect, it } from 'vitest';
import { resolveYearPlanContext, yearPlanSearch } from './year-plan-context.js';

const courses = [{ id: 'spanish' }, { id: 'history' }];
const sections = [
  { id: '5b', courseId: 'spanish' },
  { id: '5c', courseId: 'spanish' }
];

describe('Year Plan URL context', () => {
  it('keeps a valid Class Group as durable date-projection context', () => {
    expect(
      resolveYearPlanContext(
        new URLSearchParams('course=spanish&section=5c&view=outline'),
        courses,
        sections,
        null
      )
    ).toEqual({ courseId: 'spanish', sectionId: '5c', view: 'outline' });
  });
  it('does not arbitrarily choose among multiple valid courses or sections', () => {
    expect(resolveYearPlanContext(new URLSearchParams(), courses, sections, null)).toEqual({
      courseId: null,
      sectionId: null,
      view: 'timeline'
    });
  });
  it('restores the remembered Class Group for the same course', () => {
    const context = resolveYearPlanContext(new URLSearchParams(), courses, sections, {
      courseId: 'spanish',
      sectionId: '5b',
      view: 'timeline'
    });
    expect(context).toEqual({ courseId: 'spanish', sectionId: '5b', view: 'timeline' });
    expect(yearPlanSearch(context)).toBe('view=timeline&course=spanish&section=5b');
  });
  it('automatically selects the only Class Group', () => {
    expect(
      resolveYearPlanContext(
        new URLSearchParams('course=history'),
        courses,
        [{ id: 'history-a', courseId: 'history' }],
        null
      )
    ).toEqual({ courseId: 'history', sectionId: 'history-a', view: 'timeline' });
  });
  it('keeps curriculum-only planning valid when a course has no Class Groups', () => {
    expect(
      resolveYearPlanContext(new URLSearchParams('course=history'), courses, sections, null)
    ).toEqual({ courseId: 'history', sectionId: null, view: 'timeline' });
  });
});
