export type FeedbackCategory = 'bug' | 'feature_request' | 'usability' | 'other';
export const feedbackCategories: Record<FeedbackCategory, string> = {
  bug: "Something isn't working",
  feature_request: 'Suggest a feature',
  usability: 'Something is confusing',
  other: 'Other feedback'
};
export const feedbackStatuses = ['new', 'investigating', 'planned', 'fixed', 'closed'] as const;
export const feedbackPriorities = ['low', 'normal', 'high', 'critical'] as const;
export type FeedbackReport = {
  id: string;
  referenceNumber: string;
  category: FeedbackCategory;
  description: string;
  expectedBehavior: string | null;
  reproductionSteps: string | null;
  pagePath: string;
  pageName: string | null;
  sanitizedUrl: string | null;
  status: string;
  priority: string;
  createdAt: string;
  issueGroupId: string | null;
  reporterName?: string | null;
  reporterEmail?: string | null;
  schoolName?: string | null;
  context: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  appVersion?: string | null;
  commitSha?: string | null;
  environment?: string | null;
  errorFingerprint?: string | null;
  attachmentCount?: number;
};
export type FeedbackDetail = {
  report: FeedbackReport;
  attachments: { id: string; mimeType: string; width: number; height: number }[];
  replies: { id: string; message: string; visibility: string; createdAt: string }[];
  events: {
    id: string;
    eventType: string;
    eventTimestamp: string;
    metadata: Record<string, unknown>;
  }[];
  history: { id: string; createdAt: string; [key: string]: unknown }[];
  relatedReports: FeedbackReport[];
  deliveries: { id: string; status: string; attemptCount: number; errorCode?: string }[];
};

export function diagnosticExport(detail: FeedbackDetail) {
  const r = detail.report;
  return {
    reference: r.referenceNumber,
    category: r.category,
    description: r.description,
    expectedBehavior: r.expectedBehavior,
    reproductionSteps: r.reproductionSteps,
    page: { path: r.pagePath, name: r.pageName },
    context: r.context,
    diagnostics: r.diagnostics,
    events: detail.events,
    version: { appVersion: r.appVersion, commitSha: r.commitSha, environment: r.environment }
  };
}

export function debugReport(detail: FeedbackDetail): string {
  const r = detail.report;
  return [
    `TeacherOS Feedback ${r.referenceNumber}`,
    `Category: ${r.category}`,
    `Page: ${r.pageName ?? r.pagePath} (${r.pagePath})`,
    '',
    'Problem:',
    r.description,
    '',
    'Expected:',
    r.expectedBehavior ?? 'Not provided',
    '',
    'Steps to reproduce:',
    r.reproductionSteps ?? 'Not provided',
    '',
    'Submitted technical context:',
    JSON.stringify(diagnosticExport(detail), null, 2)
  ].join('\n');
}
