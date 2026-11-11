import { z } from 'zod';

const safeText = (max = 120) => z.string().max(max).transform(redactDiagnosticText);
const identifier = z
  .string()
  .max(120)
  .regex(/^[a-zA-Z0-9_.: /-]*$/);
const dimension = z.number().finite().min(0).max(100000);
const size = z.object({ width: dimension, height: dimension }).strict();
const time = z.string().datetime({ offset: true });
export function redactDiagnosticText(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, '[redacted]')
    .replace(/(?:sk-|pk_|sk_)[A-Za-z0-9_-]{10,}/g, '[redacted]')
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]')
    .replace(
      /(password|secret|token|authorization|cookie|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[redacted]'
    )
    .replace(/https?:\/\/[^\s]+/g, (url) => sanitizeLocation(url));
}
export function sanitizeLocation(value: string): string {
  try {
    const url = new URL(value, 'https://internal.invalid');
    const allowed = new URLSearchParams();
    for (const key of [
      'courseId',
      'sectionId',
      'unitId',
      'lessonId',
      'meetingId',
      'date',
      'view',
      'tab'
    ]) {
      const v = url.searchParams.get(key);
      if (v && /^[a-zA-Z0-9_.:-]{1,100}$/.test(v)) allowed.set(key, v);
    }
    const query = allowed.toString();
    // Only retain the internal location: origins can contain credentials or identify private hosts.
    return url.pathname.slice(0, 500) + (query ? `?${query}` : '');
  } catch {
    return '/';
  }
}
const eventMetadata = z
  .object({
    method: identifier.optional(),
    endpoint: z.string().max(500).transform(sanitizeLocation).optional(),
    errorCode: identifier.optional(),
    mode: identifier.optional(),
    changed: z.boolean().optional(),
    activeTab: identifier.optional(),
    panel: identifier.optional(),
    component: identifier.optional(),
    componentId: identifier.optional(),
    courseId: identifier.optional(),
    sectionId: identifier.optional(),
    unitId: identifier.optional(),
    lessonId: identifier.optional(),
    meetingId: identifier.optional(),
    schoolId: identifier.optional(),
    route: z.string().max(500).transform(sanitizeLocation).optional(),
    path: z.string().max(500).transform(sanitizeLocation).optional(),
    page: identifier.optional(),
    operation: identifier.optional(),
    success: z.boolean().optional(),
    status: z.union([identifier, z.number()]).optional(),
    outcome: identifier.optional(),
    requestId: identifier.optional(),
    view: identifier.optional(),
    selectedDate: identifier.optional()
  })
  .strip();
export const FeedbackContextSchema = z
  .object({
    courseId: identifier.optional(),
    sectionId: identifier.optional(),
    unitId: identifier.optional(),
    lessonId: identifier.optional(),
    meetingId: identifier.optional(),
    schoolId: identifier.optional(),
    selectedDate: identifier.optional(),
    view: identifier.optional(),
    activeTab: identifier.optional(),
    panel: identifier.optional(),
    component: identifier.optional(),
    selectedElement: z
      .object({
        componentId: identifier.optional(),
        testId: identifier.optional(),
        tagName: identifier.optional(),
        parentComponentId: identifier.optional(),
        bounds: z
          .object({
            x: z.number().finite().min(-100000).max(100000),
            y: z.number().finite().min(-100000).max(100000),
            width: dimension,
            height: dimension
          })
          .strict(),
        pagePath: z.string().max(500).transform(sanitizeLocation)
      })
      .strict()
      .optional()
  })
  .strict();
export const FeedbackDiagnosticsSchema = z
  .object({
    clientSessionId: z.string().uuid().optional(),
    capturedAt: time.optional(),
    events: z
      .array(
        z.object({ type: identifier, timestamp: time, metadata: eventMetadata.optional() }).strict()
      )
      .max(40)
      .optional(),
    errors: z
      .array(
        z
          .object({
            category: identifier,
            message: safeText(500),
            fingerprint: identifier,
            timestamp: time,
            route: z.string().max(500).transform(sanitizeLocation),
            stack: safeText(2000).optional(),
            correlationId: identifier.optional()
          })
          .strict()
      )
      .max(12)
      .optional(),
    network: z
      .array(
        z
          .object({
            method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
            endpoint: z.string().max(500).transform(sanitizeLocation),
            status: z.number().int().min(0).max(599),
            duration: z.number().finite().min(0).max(3600000),
            timestamp: time,
            requestId: identifier.optional(),
            errorCode: identifier.optional()
          })
          .strict()
      )
      .max(20)
      .optional(),
    browser: z
      .object({
        family: identifier,
        version: identifier,
        os: identifier,
        device: identifier,
        viewport: size,
        screen: size,
        pixelRatio: z.number().finite().min(0).max(20),
        language: identifier,
        online: z.boolean(),
        timezone: identifier
      })
      .strict()
      .optional(),
    app: z
      .object({
        version: identifier,
        commitSha: identifier,
        environment: identifier,
        deploymentId: identifier.optional()
      })
      .strict()
      .optional()
  })
  .strict();
export const FeedbackSubmissionSchema = z
  .object({
    clientReportId: z.string().uuid(),
    clientSessionId: z.string().uuid().optional(),
    category: z.enum(['bug', 'feature_request', 'usability', 'other']),
    description: z.string().trim().max(10000).default(''),
    expectedBehavior: z.string().max(5000).optional(),
    reproductionSteps: z.string().max(5000).optional(),
    pagePath: z.string().max(500).transform(sanitizeLocation),
    pageName: safeText(100).optional(),
    sanitizedUrl: z.string().max(1000).transform(sanitizeLocation).optional(),
    context: FeedbackContextSchema.optional(),
    diagnostics: FeedbackDiagnosticsSchema.optional(),
    appVersion: identifier.optional(),
    commitSha: identifier.optional(),
    environment: identifier.optional(),
    attachment: z
      .object({ dataUrl: z.string().max(7_000_000) })
      .strict()
      .optional()
  })
  .strict();
