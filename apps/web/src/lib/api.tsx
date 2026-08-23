import { useMemo } from 'react';

import type {
  AiJobControlResponse,
  AiJobEnqueueResponse,
  AiJobStatusResponse,
  CalendarCommitRequest,
  CalendarCommitResponse,
  CalendarImportRequest,
  CalendarImportResponse,
  ClassNotesUpsertRequest,
  ClassNotesUpsertResponse,
  ClassroomResumeResponse,
  CourseCreateRequest,
  CourseDetailResponse,
  CourseListResponse,
  CourseOrderUpdateRequest,
  CourseUpdateRequest,
  DashboardTodayResponse,
  DeleteEntityResponse,
  FeedbackSubmitRequest,
  FeedbackSubmitResponse,
  GenerateContinuityRequest,
  GenerateContinuityResponse,
  GenerateSegmentsRequest,
  GenerateSegmentsResponse,
  GenerateUnitDraftRequest,
  GenerateUnitDraftResponse,
  GetScheduleResponse,
  HolidaysUpsertRequest,
  HolidaysUpsertResponse,
  LessonProgressUpsertRequest,
  LessonProgressUpsertResponse,
  LessonCreateRequest,
  LessonUpdateRequest,
  MeetingInstancesResponse,
  OnboardingRequest,
  OnboardingResponse,
  ParseScheduleResponse,
  ProfileResponse,
  ProfileUpdateRequest,
  ProfileUpdateResponse,
  SegmentCreateRequest,
  SegmentUpdateRequest,
  ScheduleImportCorrectionRequest,
  ScheduleImportApplyRequest,
  ScheduleImportRequest,
  SchoolCalendarResponse,
  SchoolYearUpsertRequest,
  SectionMeetingOverrideRequest,
  SectionMutationRequest,
  SectionUpdateRequest,
  UnitCreateRequest,
  UnitUpdateRequest,
  TeacherPreferences,
  TeacherPreferencesUpdateRequest
} from '@teacheros/contracts';

import { useAppAuth } from './auth.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';
const API_REQUEST_TIMEOUT_MS = 25_000;
const AI_REQUEST_TIMEOUT_MS = 120_000;
// Queueing is normally fast, but Render can need longer than the ordinary API
// timeout to wake a sleeping service. Let the first schedule-read request wait
// long enough to create its job; the actual AI work then happens in the
// background and is polled by the page.
const AI_QUEUE_REQUEST_TIMEOUT_MS = 90_000;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

async function request<TResponse>(
  path: string,
  init: RequestInit,
  auth: ReturnType<typeof useAppAuth>,
  timeoutMs = API_REQUEST_TIMEOUT_MS
): Promise<TResponse> {
  const token = await auth.getToken();
  const headers = new Headers(init.headers);
  // An empty DELETE request with an application/json header is rejected by
  // Fastify as an empty JSON body. Only advertise JSON when we actually send
  // a JSON payload. This also keeps body-less GET/DELETE requests simple.
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  } else if (auth.mode === 'dev' && auth.userId) {
    headers.set('x-dev-user-id', auth.userId);
    if (auth.email) headers.set('x-dev-user-email', auth.email);
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      const message =
        timeoutMs === AI_QUEUE_REQUEST_TIMEOUT_MS
          ? 'TeacherDesk is starting its schedule reader. The service took longer than expected to wake, so your schedule was not sent. Please try “Read my schedule” once more.'
          : 'The backend is taking too long to respond. It may be waking up; try again in a moment.';
      throw new ApiError(message, 408);
    }
    throw new ApiError(
      'Could not reach the backend. Check the backend status indicator and try again.',
      0
    );
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    const fallback =
      response.status === 413
        ? 'That schedule file is too large to send. Please use a file smaller than 10 MB.'
        : response.status >= 500
          ? 'The backend hit an error. Try again, and send feedback if it repeats.'
          : `Request failed (${response.status})`;
    throw new ApiError(payload?.error ?? fallback, response.status);
  }

  return (await response.json()) as TResponse;
}

export function useApiClient() {
  const auth = useAppAuth();

  return useMemo(
    () => ({
      onboarding: (body: OnboardingRequest) =>
        request<OnboardingResponse>(
          '/v1/onboarding',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      getProfile: () => request<ProfileResponse>('/v1/profile', { method: 'GET' }, auth),
      updateProfile: (body: ProfileUpdateRequest) =>
        request<ProfileUpdateResponse>(
          '/v1/profile',
          { method: 'PATCH', body: JSON.stringify(body) },
          auth
        ),
      dashboardToday: () =>
        request<DashboardTodayResponse>('/v1/dashboard/today', { method: 'GET' }, auth),
      getSchedule: () => request<GetScheduleResponse>('/v1/schedule', { method: 'GET' }, auth),
      getSchoolCalendar: () =>
        request<SchoolCalendarResponse>('/v1/school-calendar', { method: 'GET' }, auth),
      saveSchoolYear: (body: SchoolYearUpsertRequest) =>
        request<SchoolCalendarResponse>(
          '/v1/school-year',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      importSchoolCalendar: (body: CalendarImportRequest) =>
        request<CalendarImportResponse>(
          '/v1/school-calendar/import',
          { method: 'POST', body: JSON.stringify(body) },
          auth,
          AI_REQUEST_TIMEOUT_MS
        ),
      commitSchoolCalendar: (body: CalendarCommitRequest) =>
        request<CalendarCommitResponse>(
          '/v1/school-calendar/commit',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      getMeetingInstances: () =>
        request<MeetingInstancesResponse>('/v1/meeting-instances', { method: 'GET' }, auth),
      getPreferences: () => request<TeacherPreferences>('/v1/preferences', { method: 'GET' }, auth),
      updatePreferences: (body: TeacherPreferencesUpdateRequest) =>
        request<TeacherPreferences>(
          '/v1/preferences',
          { method: 'PATCH', body: JSON.stringify(body) },
          auth
        ),
      createSection: (body: SectionMutationRequest) =>
        request<GetScheduleResponse>(
          '/v1/sections',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      updateSection: (sectionId: string, body: SectionUpdateRequest) =>
        request<GetScheduleResponse>(
          `/v1/sections/${sectionId}`,
          { method: 'PATCH', body: JSON.stringify(body) },
          auth
        ),
      saveSectionMeetingOverride: (sectionId: string, body: SectionMeetingOverrideRequest) =>
        request<MeetingInstancesResponse>(
          `/v1/sections/${sectionId}/meeting-overrides`,
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      deleteSection: (sectionId: string) =>
        request<DeleteEntityResponse>(`/v1/sections/${sectionId}`, { method: 'DELETE' }, auth),
      getClassroomResume: (sectionId: string) =>
        request<ClassroomResumeResponse>(
          `/v1/sections/${sectionId}/resume`,
          { method: 'GET' },
          auth
        ),
      listCourses: () => request<CourseListResponse>('/v1/courses', { method: 'GET' }, auth),
      getCourseDetail: (courseId: string) =>
        request<CourseDetailResponse>(`/v1/courses/${courseId}`, { method: 'GET' }, auth),
      createCourse: (body: CourseCreateRequest) =>
        request<CourseDetailResponse>(
          '/v1/courses',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      updateCourse: (courseId: string, body: CourseUpdateRequest) =>
        request<CourseDetailResponse>(
          `/v1/courses/${courseId}`,
          { method: 'PATCH', body: JSON.stringify(body) },
          auth
        ),
      updateCourseOrder: (body: CourseOrderUpdateRequest) =>
        request<CourseListResponse>(
          '/v1/courses/order',
          { method: 'PATCH', body: JSON.stringify(body) },
          auth
        ),
      deleteCourse: (courseId: string) =>
        request<DeleteEntityResponse>(`/v1/courses/${courseId}`, { method: 'DELETE' }, auth),
      createUnit: (courseId: string, body: UnitCreateRequest) =>
        request<CourseDetailResponse>(
          `/v1/courses/${courseId}/units`,
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      updateUnit: (unitId: string, body: UnitUpdateRequest) =>
        request<CourseDetailResponse>(
          `/v1/units/${unitId}`,
          { method: 'PATCH', body: JSON.stringify(body) },
          auth
        ),
      deleteUnit: (unitId: string) =>
        request<DeleteEntityResponse>(`/v1/units/${unitId}`, { method: 'DELETE' }, auth),
      createLesson: (unitId: string, body: LessonCreateRequest) =>
        request<CourseDetailResponse>(
          `/v1/units/${unitId}/lessons`,
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      updateLesson: (lessonId: string, body: LessonUpdateRequest) =>
        request<CourseDetailResponse>(
          `/v1/lessons/${lessonId}`,
          { method: 'PATCH', body: JSON.stringify(body) },
          auth
        ),
      deleteLesson: (lessonId: string) =>
        request<DeleteEntityResponse>(`/v1/lessons/${lessonId}`, { method: 'DELETE' }, auth),
      createSegment: (lessonId: string, body: SegmentCreateRequest) =>
        request<CourseDetailResponse>(
          `/v1/lessons/${lessonId}/segments`,
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      updateSegment: (segmentId: string, body: SegmentUpdateRequest) =>
        request<CourseDetailResponse>(
          `/v1/segments/${segmentId}`,
          { method: 'PATCH', body: JSON.stringify(body) },
          auth
        ),
      deleteSegment: (segmentId: string) =>
        request<DeleteEntityResponse>(`/v1/segments/${segmentId}`, { method: 'DELETE' }, auth),
      importSchedule: (body: ScheduleImportRequest) =>
        request<ParseScheduleResponse>(
          '/v1/schedule/import',
          { method: 'POST', body: JSON.stringify(body) },
          auth,
          AI_REQUEST_TIMEOUT_MS
        ),
      correctScheduleImport: (body: ScheduleImportCorrectionRequest) =>
        request<ParseScheduleResponse>(
          '/v1/schedule/import/correct',
          { method: 'POST', body: JSON.stringify(body) },
          auth,
          AI_REQUEST_TIMEOUT_MS
        ),
      applyScheduleImport: (body: ScheduleImportApplyRequest) =>
        request<GetScheduleResponse>(
          '/v1/schedule/import/apply',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      enqueueParseSchedule: (body: ScheduleImportRequest) =>
        request<AiJobEnqueueResponse>(
          '/v1/ai/parse-schedule/queue',
          { method: 'POST', body: JSON.stringify(body) },
          auth,
          AI_QUEUE_REQUEST_TIMEOUT_MS
        ),
      enqueueGenerateSegments: (body: GenerateSegmentsRequest) =>
        request<AiJobEnqueueResponse>(
          '/v1/ai/generate-segments/queue',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      enqueueGenerateContinuity: (body: GenerateContinuityRequest) =>
        request<AiJobEnqueueResponse>(
          '/v1/ai/generate-continuity/queue',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      getAiJobStatus: (jobId: string) =>
        request<AiJobStatusResponse>(`/v1/ai/jobs/${jobId}`, { method: 'GET' }, auth),
      cancelAiJob: (jobId: string) =>
        request<AiJobControlResponse>(`/v1/ai/jobs/${jobId}/cancel`, { method: 'POST' }, auth),
      retryAiJob: (jobId: string) =>
        request<AiJobControlResponse>(`/v1/ai/jobs/${jobId}/retry`, { method: 'POST' }, auth),
      upsertHolidays: (body: HolidaysUpsertRequest) =>
        request<HolidaysUpsertResponse>(
          '/v1/holidays',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      deleteHoliday: (holidayId: string) =>
        request<DeleteEntityResponse>(`/v1/holidays/${holidayId}`, { method: 'DELETE' }, auth),
      submitFeedback: (body: FeedbackSubmitRequest) =>
        request<FeedbackSubmitResponse>(
          '/v1/feedback',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      upsertLessonProgress: (body: LessonProgressUpsertRequest) =>
        request<LessonProgressUpsertResponse>(
          '/v1/lesson-progress/upsert',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      upsertClassNote: (body: ClassNotesUpsertRequest) =>
        request<ClassNotesUpsertResponse>(
          '/v1/class-notes/upsert',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      generateSegments: (body: GenerateSegmentsRequest) =>
        request<GenerateSegmentsResponse>(
          '/v1/ai/generate-segments',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      generateUnitDraft: (body: GenerateUnitDraftRequest) =>
        request<GenerateUnitDraftResponse>(
          '/v1/ai/generate-unit-draft',
          { method: 'POST', body: JSON.stringify(body) },
          auth,
          AI_REQUEST_TIMEOUT_MS
        ),
      generateContinuity: (body: GenerateContinuityRequest) =>
        request<GenerateContinuityResponse>(
          '/v1/ai/generate-continuity',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        )
    }),
    [auth]
  );
}
