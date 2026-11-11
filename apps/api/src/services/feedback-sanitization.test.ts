import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  FeedbackSubmissionSchema,
  redactDiagnosticText,
  sanitizeLocation
} from './feedback-sanitization.js';

const valid = {
  clientReportId: randomUUID(),
  category: 'bug',
  description: 'The lesson would not move.',
  pagePath: '/year-plan'
};
describe('feedback privacy validation', () => {
  it('accepts written reports without diagnostics', () => {
    expect(FeedbackSubmissionSchema.safeParse(valid).success).toBe(true);
  });
  it('accepts blank or omitted optional descriptions', () => {
    expect(FeedbackSubmissionSchema.parse({ ...valid, description: '  ' }).description).toBe('');
    expect(FeedbackSubmissionSchema.parse({ ...valid, description: undefined }).description).toBe(
      ''
    );
  });
  it('rejects forged identity and invalid categories', () => {
    for (const data of [
      { ...valid, reporterUserId: randomUUID() },
      { ...valid, category: 'admin' }
    ])
      expect(FeedbackSubmissionSchema.safeParse(data).success).toBe(false);
  });
  it('rejects private fields, deeply nested arbitrary data and oversized histories', () => {
    expect(
      FeedbackSubmissionSchema.safeParse({ ...valid, diagnostics: { cookies: 'private' } }).success
    ).toBe(false);
    expect(
      FeedbackSubmissionSchema.safeParse({
        ...valid,
        context: { studentNotes: { text: 'private' } }
      }).success
    ).toBe(false);
    expect(
      FeedbackSubmissionSchema.safeParse({
        ...valid,
        diagnostics: {
          events: Array.from({ length: 41 }, () => ({
            type: 'click',
            timestamp: new Date().toISOString()
          }))
        }
      }).success
    ).toBe(false);
  });
  it('retains only allowed URL selection parameters', () => {
    expect(
      sanitizeLocation(
        'https://user:pass@example.org/year-plan?token=private&courseId=course-1#password'
      )
    ).toBe('/year-plan?courseId=course-1');
  });
  it('redacts credentials, personal emails and private URL parameters', () => {
    const result = redactDiagnosticText(
      'Bearer bearer-secret password=private student@example.com https://app.test/lessons?token=private'
    );
    expect(result).not.toContain('bearer-secret');
    expect(result).not.toContain('private');
    expect(result).not.toContain('student@example.com');
  });
  it('strips arbitrary event metadata without ever copying form contents', () => {
    const result = FeedbackSubmissionSchema.parse({
      ...valid,
      diagnostics: {
        events: [
          {
            type: 'save',
            timestamp: new Date().toISOString(),
            metadata: {
              lessonId: 'lesson-1',
              value: 'private student notes',
              requestBody: 'secret'
            }
          }
        ]
      }
    });
    expect(result.diagnostics?.events?.[0]?.metadata).toEqual({ lessonId: 'lesson-1' });
  });
});
