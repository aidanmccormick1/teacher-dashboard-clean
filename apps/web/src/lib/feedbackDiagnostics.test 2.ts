import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearFeedbackDiagnostics,
  getFeedbackDiagnosticsGeneration,
  getFeedbackContext,
  recordFeedbackError,
  recordFeedbackEvent,
  recordFeedbackNetworkFailure,
  registerFeedbackContext,
  sanitizeDiagnosticMetadata,
  sanitizeFeedbackPath,
  snapshotFeedbackDiagnostics,
  startFeedbackDiagnostics
} from './feedbackDiagnostics.js';

afterEach(() => {
  vi.unstubAllGlobals();
});
function location(pathname: string, search = '') {
  vi.stubGlobal('window', {
    location: { pathname, search },
    innerWidth: 1200,
    innerHeight: 800,
    devicePixelRatio: 1
  });
}
describe('feedback diagnostics privacy and bounds', () => {
  it('discards arbitrary metadata and private values', () => {
    expect(
      sanitizeDiagnosticMetadata({
        lessonId: 'lesson-123',
        password: 'secret',
        notes: 'Student Jane scored 90',
        courseName: 'Private class',
        requestId: 'request-123',
        component: 'save_button',
        activeTab: 'private classroom words',
        success: false
      })
    ).toEqual({
      lessonId: 'lesson-123',
      requestId: 'request-123',
      component: 'save_button',
      success: false
    });
  });
  it('strips query strings and private share tokens from endpoints', () => {
    expect(sanitizeFeedbackPath('/v1/courses/course-123?token=secret&student=Jane')).toBe(
      '/v1/courses/course-123'
    );
    expect(sanitizeFeedbackPath('/v1/public/lessons/private-token')).toBe(
      '/v1/public/lessons/[redacted]'
    );
    expect(sanitizeFeedbackPath('/shared/curriculum/private-token')).toBe(
      '/shared/curriculum/[redacted]'
    );
    expect(sanitizeFeedbackPath('/v1/courses/jane@example.com')).toBe('/v1/courses/[redacted]');
  });
  it('only includes safe URL query state, and active context cleans up', () => {
    location(
      '/year-plan',
      '?course=course-one&section=section-a&view=outline&token=secret&student=Jane'
    );
    const cleanup = registerFeedbackContext({ sectionId: 'section-b', lessonId: 'lesson-1' });
    expect(getFeedbackContext().context).toMatchObject({
      courseId: 'course-one',
      sectionId: 'section-b',
      lessonId: 'lesson-1',
      view: 'outline'
    });
    expect(getFeedbackContext().sanitizedUrl).not.toContain('secret');
    cleanup();
    expect(getFeedbackContext().context.sectionId).toBe('section-a');
    expect(getFeedbackContext().context.lessonId).toBeUndefined();
  });
  it('does not leak context after navigation', () => {
    location('/classroom');
    const cleanup = registerFeedbackContext({ sectionId: 'section-a' });
    location('/courses');
    expect(getFeedbackContext().context.sectionId).toBeUndefined();
    cleanup();
  });
  it.each([
    ['/today', 'Today'],
    ['/year-plan', 'Year Plan'],
    ['/courses', 'Courses'],
    ['/curriculum', 'Curriculum'],
    ['/lessons/lesson-1', 'Lesson Editor'],
    ['/schedule', 'Schedule'],
    ['/classroom', 'Classroom'],
    ['/school', 'School']
  ])('identifies the page at %s', (pathname, name) => {
    location(pathname);
    expect(getFeedbackContext().pageName).toBe(name);
  });
  it('finds route IDs on lesson and tracker pages', () => {
    location('/lessons/lesson-one');
    expect(getFeedbackContext()).toMatchObject({
      pageName: 'Lesson Editor',
      context: { lessonId: 'lesson-one' }
    });
    location('/sections/section-one/lessons/lesson-two');
    expect(getFeedbackContext().context).toMatchObject({
      sectionId: 'section-one',
      lessonId: 'lesson-two'
    });
  });
  it('bounds event/error/network histories and never retains error prose or bodies', () => {
    location('/today');
    for (let i = 0; i < 100; i++) {
      recordFeedbackEvent('save', { lessonId: `lesson-${i}`, notes: 'student notes' });
      recordFeedbackError('save_failed', new Error('secret token and student Jane'), {
        authorization: 'Bearer secret'
      });
      recordFeedbackNetworkFailure({
        method: 'POST',
        endpoint: '/v1/lessons/lesson-1?token=secret',
        status: 500,
        duration: 10.2,
        requestId: 'request-1'
      });
    }
    const snapshot = snapshotFeedbackDiagnostics();
    expect(snapshot.events).toHaveLength(35);
    expect(snapshot.errors).toHaveLength(12);
    expect(snapshot.network).toHaveLength(15);
    expect(JSON.stringify(snapshot)).not.toMatch(/secret|student notes|student Jane|authorization/);
    expect(snapshot.network[0]).toMatchObject({
      endpoint: '/v1/lessons/lesson-1',
      status: 500,
      requestId: 'request-1',
      duration: 10
    });
  });
  it('distinguishes Edge from its Chrome user agent token', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.56',
      language: 'en-US',
      onLine: true
    });
    expect(snapshotFeedbackDiagnostics().browser.family).toBe('Edg');
    expect(snapshotFeedbackDiagnostics().browser.version).toBe('130.0.2849.56');
  });
  it('copies snapshots so consumers cannot mutate the buffers', () => {
    recordFeedbackEvent('save', { lessonId: 'lesson-one' });
    const first = snapshotFeedbackDiagnostics();
    first.events[first.events.length - 1]!.metadata.lessonId = 'changed';
    expect(snapshotFeedbackDiagnostics().events.at(-1)?.metadata.lessonId).toBe('lesson-one');
  });
  it('clears all account diagnostics and rotates the session on account switch or signout', () => {
    location('/classroom');
    const unregister = registerFeedbackContext({ sectionId: 'prior-account-section' });
    recordFeedbackEvent('save', { lessonId: 'prior-account-lesson' });
    recordFeedbackError('save_failed', new Error('private'));
    recordFeedbackNetworkFailure({
      method: 'POST',
      endpoint: '/v1/lessons/prior-account-lesson',
      status: 500,
      duration: 1
    });
    const previousSession = snapshotFeedbackDiagnostics().clientSessionId;
    const previousGeneration = getFeedbackDiagnosticsGeneration();
    clearFeedbackDiagnostics();
    const next = snapshotFeedbackDiagnostics();
    expect(next.events).toEqual([]);
    expect(next.errors).toEqual([]);
    expect(next.network).toEqual([]);
    expect(next.clientSessionId).not.toBe(previousSession);
    expect(getFeedbackContext().context).toEqual({});
    expect(getFeedbackDiagnosticsGeneration()).toBe(previousGeneration + 1);
    unregister();
  });
  it('installs listeners once and removes them after the final consumer', () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal('window', { addEventListener, removeEventListener });
    const first = startFeedbackDiagnostics();
    const second = startFeedbackDiagnostics();
    expect(addEventListener).toHaveBeenCalledTimes(2);
    first();
    first();
    expect(removeEventListener).not.toHaveBeenCalled();
    second();
    expect(removeEventListener).toHaveBeenCalledTimes(2);
  });
});
