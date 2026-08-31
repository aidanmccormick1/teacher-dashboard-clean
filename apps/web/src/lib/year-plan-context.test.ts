import { describe, expect, it } from 'vitest';
import { resolveYearPlanContext, yearPlanSearch } from './year-plan-context.js';

const courses = [{ id: 'spanish' }, { id: 'history' }];
const sections = [
  { id: '5b', courseId: 'spanish' },
  { id: '5c', courseId: 'spanish' }
];

describe('Year Plan URL context', () => {
  it('keeps valid course context while dropping section planning context', () => {
    expect(
      resolveYearPlanContext(
        new URLSearchParams('course=spanish&section=5c&view=outline'),
        courses,
        sections,
        null
      )
    ).toEqual({ courseId: 'spanish', sectionId: null, view: 'outline' });
  });
  it('does not arbitrarily choose among multiple valid courses or sections', () => {
    expect(resolveYearPlanContext(new URLSearchParams(), courses, sections, null)).toEqual({
      courseId: null,
      sectionId: null,
      view: 'timeline'
    });
  });
  it('restores a remembered course but defaults to shared course planning', () => {
    const context = resolveYearPlanContext(new URLSearchParams(), courses, sections, {
      courseId: 'spanish',
      sectionId: '5b',
      view: 'timeline'
    });
    expect(context).toEqual({ courseId: 'spanish', sectionId: null, view: 'timeline' });
    expect(yearPlanSearch(context)).toBe('view=timeline&course=spanish');
  });
});
