import { describe, expect, it } from 'vitest';

import {
  primaryNavigationIdForPath,
  readSidebarCollapsed,
  saveSidebarCollapsed,
  sidebarCollapsedStorageKey
} from './navigation.js';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    }
  };
}

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
    ['/school', 'school']
  ] as const)('marks %s as %s', (pathname, expected) => {
    expect(primaryNavigationIdForPath(pathname)).toBe(expected);
  });

  it('does not make a secondary route a primary destination', () => {
    expect(primaryNavigationIdForPath('/profile')).toBeNull();
  });
});

describe('sidebar collapse preference', () => {
  it('persists collapse state across a remount', () => {
    const storage = createStorage();

    expect(readSidebarCollapsed(storage)).toBe(false);
    saveSidebarCollapsed(true, storage);

    expect(storage.getItem(sidebarCollapsedStorageKey)).toBe('true');
    expect(readSidebarCollapsed(storage)).toBe(true);
  });
});
