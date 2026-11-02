import { describe, expect, it } from 'vitest';
import { debugReport, diagnosticExport, type FeedbackDetail } from './feedbackTypes.js';

const detail: FeedbackDetail = {
  report: {
    id: 'report-id',
    referenceNumber: 'FB-1042',
    category: 'bug',
    description: "The lesson won't move.",
    expectedBehavior: 'Move the lesson.',
    reproductionSteps: 'Drag the last lesson.',
    pagePath: '/year-plan',
    pageName: 'Year Plan',
    sanitizedUrl: '/year-plan',
    status: 'investigating',
    priority: 'normal',
    createdAt: '2026-11-02T12:00:00Z',
    issueGroupId: null,
    reporterName: 'Private teacher name',
    reporterEmail: 'teacher@private.test',
    schoolName: 'Private School',
    context: { lessonId: 'lesson-8', unitId: 'unit-3' },
    diagnostics: {
      network: [
        {
          method: 'PATCH',
          endpoint: '/v1/lessons/lesson-8',
          status: 500,
          requestId: 'correlation-1'
        }
      ]
    },
    appVersion: '2.0',
    commitSha: 'a31c9f2',
    environment: 'test'
  },
  attachments: [{ id: 'private-object', mimeType: 'image/png', width: 100, height: 100 }],
  replies: [
    { id: 'note-1', message: 'Private internal note', visibility: 'internal', createdAt: '' }
  ],
  deliveries: [{ id: 'email-id', status: 'sent', attemptCount: 1 }],
  history: [],
  relatedReports: [],
  events: [
    {
      id: 'event-1',
      eventTimestamp: '2026-11-02T12:00:00Z',
      eventType: 'lesson_drag_end',
      metadata: { success: false, lessonId: 'lesson-8' }
    }
  ]
};

describe('feedback investigation exports', () => {
  it('retains the problem and submitted technical evidence deterministically', () => {
    const report = debugReport(detail);
    expect(report).toBe(debugReport(detail));
    for (const evidence of [
      'FB-1042',
      'Year Plan',
      'lesson-8',
      'unit-3',
      'correlation-1',
      'a31c9f2',
      'Drag the last lesson.'
    ])
      expect(report).toContain(evidence);
  });
  it('excludes reporter identity, attachments, email deliveries, private notes and admin history', () => {
    for (const exported of [debugReport(detail), JSON.stringify(diagnosticExport(detail))]) {
      for (const privateValue of [
        'Private teacher name',
        'teacher@private.test',
        'Private School',
        'private-object',
        'Private internal note',
        'email-id'
      ])
        expect(exported).not.toContain(privateValue);
    }
  });
});
