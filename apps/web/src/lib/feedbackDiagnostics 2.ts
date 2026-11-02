import { useEffect } from 'react';

export type FeedbackContext = Partial<
  Record<
    | 'courseId'
    | 'sectionId'
    | 'unitId'
    | 'lessonId'
    | 'meetingId'
    | 'schoolId'
    | 'selectedDate'
    | 'view'
    | 'activeTab'
    | 'panel'
    | 'component',
    string | null
  >
>;
type Metadata = Record<string, unknown>;
type Activity = { type: string; timestamp: string; metadata: Metadata };
type ClientError = {
  category: string;
  message: string;
  fingerprint: string;
  timestamp: string;
  route: string;
  stack?: string;
  correlationId?: string;
};
type NetworkFailure = {
  method: string;
  endpoint: string;
  status: number;
  duration: number;
  timestamp: string;
  requestId?: string;
  errorCode?: string;
};
const events: Activity[] = [];
const errors: ClientError[] = [];
const network: NetworkFailure[] = [];
const contexts = new Map<symbol, { path: string; value: FeedbackContext }>();
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const contextKeys = new Set([
  'courseId',
  'sectionId',
  'unitId',
  'lessonId',
  'meetingId',
  'schoolId',
  'selectedDate',
  'view',
  'activeTab',
  'panel',
  'component'
]);
const safeMetadataKeys = new Set([
  ...contextKeys,
  'success',
  'status',
  'method',
  'endpoint',
  'requestId',
  'errorCode',
  'mode',
  'changed'
]);
let sessionId = '';
let diagnosticsGeneration = 0;

export function clearFeedbackDiagnostics(): void {
  events.length = 0;
  errors.length = 0;
  network.length = 0;
  contexts.clear();
  sessionId = '';
  diagnosticsGeneration++;
}

export function getFeedbackDiagnosticsGeneration(): number {
  return diagnosticsGeneration;
}

let listenerUsers = 0;
let stopListeners: (() => void) | null = null;

function boundedPush<T>(buffer: T[], item: T, max: number) {
  buffer.push(item);
  if (buffer.length > max) buffer.splice(0, buffer.length - max);
}
function safeIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && idPattern.test(value) ? value : undefined;
}
export function sanitizeDiagnosticMetadata(value: unknown): Metadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Metadata = {};
  for (const [key, item] of Object.entries(value)) {
    if (!safeMetadataKeys.has(key)) continue;
    if (typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)))
      result[key] = item;
    else if (key === 'endpoint' && typeof item === 'string')
      result[key] = sanitizeFeedbackPath(item);
    else if (safeIdentifier(item)) result[key] = item;
  }
  return result;
}
export function sanitizeFeedbackPath(value: string): string {
  try {
    const path = new URL(value, 'https://teacheros.invalid').pathname;
    if (/\/(public|shared)\//.test(path))
      return path.replace(/\/(lessons|curriculum)\/[^/]+/, '/$1/[redacted]');
    return path
      .split('/')
      .map((part) => (/^[a-zA-Z0-9_-]{0,100}$/.test(part) ? part : '[redacted]'))
      .join('/')
      .slice(0, 400);
  } catch {
    return '/';
  }
}
function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return `client-${(hash >>> 0).toString(16)}`;
}
function path(): string {
  return typeof window === 'undefined' ? '/' : sanitizeFeedbackPath(window.location.pathname);
}
export function recordFeedbackEvent(type: string, metadata: Metadata = {}): void {
  boundedPush(
    events,
    {
      type: safeIdentifier(type) ?? 'application_action',
      timestamp: new Date().toISOString(),
      metadata: sanitizeDiagnosticMetadata(metadata)
    },
    35
  );
}
export function recordFeedbackError(
  category: string,
  error: unknown,
  metadata: Metadata = {}
): void {
  const name =
    error instanceof Error &&
    ['TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'AbortError'].includes(
      error.name
    )
      ? error.name
      : 'Application error';
  // Error prose can contain classroom content. Retain only error kinds and script locations.
  const stack =
    error instanceof Error
      ? error.stack
          ?.split('\n')
          .slice(1, 9)
          .map((line) => {
            const match = line.match(/(?:https?:\/\/[^\s)]+|\/[^\s)]+):\d+:\d+/);
            if (!match) return '';
            return match[0]
              .replace(/\?[^:]*?(?=:\d+:\d+$)/, '')
              .replace(/https?:\/\/[^/]+/, '')
              .replace(/\/[^/]*@[^/]*\//g, '/[redacted]/');
          })
          .filter(Boolean)
          .join('\n')
          .slice(0, 1500)
      : undefined;
  const safe = sanitizeDiagnosticMetadata(metadata);
  const item: ClientError = {
    category: safeIdentifier(category) ?? 'application_error',
    message: name,
    fingerprint: fingerprint(`${category}|${name}|${stack ?? ''}|${path()}`),
    timestamp: new Date().toISOString(),
    route: path(),
    ...(stack ? { stack } : {}),
    ...(typeof safe.requestId === 'string' ? { correlationId: safe.requestId } : {})
  };
  boundedPush(errors, item, 12);
  recordFeedbackEvent('client_error', { ...safe, success: false });
}
export function recordFeedbackNetworkFailure(input: Omit<NetworkFailure, 'timestamp'>): void {
  const item: NetworkFailure = {
    method: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(input.method)
      ? input.method
      : 'OTHER',
    endpoint: sanitizeFeedbackPath(input.endpoint),
    status: input.status,
    duration: Math.max(0, Math.round(input.duration)),
    timestamp: new Date().toISOString(),
    ...(safeIdentifier(input.requestId) ? { requestId: input.requestId } : {}),
    ...(safeIdentifier(input.errorCode) ? { errorCode: input.errorCode } : {})
  };
  boundedPush(network, item, 15);
  recordFeedbackEvent('api_failure', {
    endpoint: item.endpoint,
    method: item.method,
    status: item.status,
    requestId: item.requestId,
    success: false
  });
}
export function registerFeedbackContext(value: FeedbackContext): () => void {
  const key = Symbol('feedback context');
  contexts.set(key, { path: path(), value: sanitizeDiagnosticMetadata(value) });
  return () => {
    contexts.delete(key);
  };
}
export function useFeedbackContext(value: FeedbackContext): void {
  const serialized = JSON.stringify(sanitizeDiagnosticMetadata(value));
  useEffect(() => {
    const context = JSON.parse(serialized) as FeedbackContext;
    recordFeedbackEvent('context_changed', context);
    return registerFeedbackContext(context);
  }, [serialized]);
}
export function getFeedbackContext() {
  const pagePath = path();
  const names: Record<string, string> = {
    today: 'Today',
    'year-plan': 'Year Plan',
    courses: 'Courses',
    curriculum: 'Curriculum',
    lessons: 'Lesson Editor',
    sections: 'Lesson Tracker',
    schedule: 'Schedule',
    classroom: 'Classroom',
    school: 'School',
    profile: 'Profile',
    management: 'Management',
    admin: 'School Administration'
  };
  const context: FeedbackContext = {};
  if (typeof window !== 'undefined') {
    const query = new URLSearchParams(window.location.search);
    for (const [queryKey, contextKey] of Object.entries({
      course: 'courseId',
      section: 'sectionId',
      unit: 'unitId',
      lesson: 'lessonId',
      view: 'view',
      date: 'selectedDate',
      tab: 'activeTab'
    })) {
      const value = query.get(queryKey);
      if (safeIdentifier(value)) context[contextKey as keyof FeedbackContext] = value;
    }
  }
  const segments = pagePath.split('/');
  if (segments[1] === 'courses' && safeIdentifier(segments[2])) context.courseId = segments[2];
  if (segments[1] === 'lessons' && safeIdentifier(segments[2])) context.lessonId = segments[2];
  if (segments[1] === 'sections') {
    if (safeIdentifier(segments[2])) context.sectionId = segments[2];
    if (safeIdentifier(segments[4])) context.lessonId = segments[4];
  }
  for (const entry of contexts.values())
    if (entry.path === pagePath) Object.assign(context, entry.value);
  const safeQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(context)) if (value) safeQuery.set(key, value);
  return {
    pagePath,
    pageName: names[segments[1] ?? ''] ?? 'TeacherOS',
    routeIdentifier: segments[1] ?? 'home',
    sanitizedUrl: `${pagePath}${safeQuery.size ? `?${safeQuery.toString()}` : ''}`,
    context
  };
}
export function snapshotFeedbackDiagnostics() {
  if (!sessionId)
    sessionId = globalThis.crypto?.randomUUID?.() ?? `session-${Date.now().toString(36)}`;
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const browserMatch =
    ua.match(/(Edg)\/(\d+(?:\.\d+)*)/) ?? ua.match(/(Firefox|Chrome|Version)\/(\d+(?:\.\d+)*)/);
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Unknown';
  return {
    events: events.map((item) => ({ ...item, metadata: { ...item.metadata } })),
    errors: errors.map((item) => ({ ...item })),
    network: network.map((item) => ({ ...item })),
    clientSessionId: sessionId,
    capturedAt: new Date().toISOString(),
    browser: {
      family: browserMatch?.[1] === 'Version' ? 'Safari' : (browserMatch?.[1] ?? 'Unknown'),
      version: browserMatch?.[2] ?? '',
      os,
      device: /iPad|Tablet/.test(ua)
        ? 'tablet'
        : /Mobile|Android|iPhone/.test(ua)
          ? 'mobile'
          : 'desktop',
      viewport:
        typeof window === 'undefined'
          ? null
          : { width: window.innerWidth, height: window.innerHeight },
      screen: typeof screen === 'undefined' ? null : { width: screen.width, height: screen.height },
      pixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio,
      language: typeof navigator === 'undefined' ? '' : navigator.language,
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    app: {
      version: import.meta.env.VITE_APP_VERSION ?? 'development',
      commitSha: import.meta.env.VITE_COMMIT_SHA ?? 'unknown',
      environment: import.meta.env.MODE,
      deploymentId: import.meta.env.VITE_DEPLOYMENT_ID ?? ''
    }
  };
}
export function openFeedbackForError(
  description = 'Something went wrong while I was using this page.'
): void {
  window.dispatchEvent(
    new CustomEvent('teacheros:feedback', { detail: { category: 'bug', description } })
  );
}
export function startFeedbackDiagnostics(): () => void {
  listenerUsers++;
  if (!stopListeners && typeof window !== 'undefined') {
    const onError = (event: ErrorEvent) => recordFeedbackError('unhandled_exception', event.error);
    const onRejection = (event: PromiseRejectionEvent) =>
      recordFeedbackError('unhandled_rejection', event.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    stopListeners = () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    listenerUsers--;
    if (!listenerUsers) {
      stopListeners?.();
      stopListeners = null;
    }
  };
}
