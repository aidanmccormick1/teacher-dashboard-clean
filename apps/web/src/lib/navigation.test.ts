import { describe, expect, it } from 'vitest';

import { primaryNavigationIdForPath } from './navigation.js';

describe('primary navigation matching', () => {
  it.each([
    ['/today', 'today'],
    ['/dashboard', 'today'],
    ['/classroom', 'today'],
    ['/classroom/lesson', 'today'],
    ['/year-plan', 'year-plan'],
    ['/year-plan/', 'year-plan'],
    ['/courses', 'courses'],
    ['/courses/course-1', 'courses'],
    ['/sharing', 'sharing'],
    ['/school', 'school']
  ] as const)('marks %s as %s', (pathname, expected) => {
    expect(primaryNavigationIdForPath(pathname)).toBe(expected);
  });

  it('does not make a secondary route a primary destination', () => {
    expect(primaryNavigationIdForPath('/profile')).toBeNull();
  });
});
