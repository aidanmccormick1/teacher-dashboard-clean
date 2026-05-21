import { useMemo } from 'react';

import type {
  AiJobControlResponse,
  AiJobEnqueueResponse,
  AiJobStatusResponse,
  ClassNotesUpsertRequest,
  ClassNotesUpsertResponse,
  ClassroomResumeResponse,
  CourseCreateRequest,
  CourseDetailResponse,
  CourseListResponse,
  CourseUpdateRequest,
  DashboardTodayResponse,
  DeleteEntityResponse,
  GenerateContinuityRequest,
  GenerateContinuityResponse,
  GenerateSegmentsRequest,
  GenerateSegmentsResponse,
  GetScheduleResponse,
  HolidaysUpsertRequest,
  HolidaysUpsertResponse,
  LessonProgressUpsertRequest,
  LessonProgressUpsertResponse,
  LessonCreateRequest,
  LessonUpdateRequest,
  OnboardingRequest,
  OnboardingResponse,
  ParseScheduleResponse,
  ProfileResponse,
  ProfileUpdateRequest,
  ProfileUpdateResponse,
  SegmentCreateRequest,
  SegmentUpdateRequest,
  ScheduleImportRequest,
  SectionMutationRequest,
  SectionUpdateRequest,
  UnitCreateRequest,
  UnitUpdateRequest
} from '@teacheros/contracts';

import { useAppAuth } from './auth.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

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
  auth: ReturnType<typeof useAppAuth>
): Promise<TResponse> {
  const token = await auth.getToken();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  } else if (auth.mode === 'dev' && auth.userId) {
    headers.set('x-dev-user-id', auth.userId);
    if (auth.email) headers.set('x-dev-user-email', auth.email);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(payload?.error ?? `Request failed (${response.status})`, response.status);
  }

  return (await response.json()) as TResponse;
}

export function useApiClient() {
  const auth = useAppAuth();

  return useMemo(
    () => ({
      onboarding: (body: OnboardingRequest) =>
        request<OnboardingResponse>('/v1/onboarding', { method: 'POST', body: JSON.stringify(body) }, auth),
      getProfile: () => request<ProfileResponse>('/v1/profile', { method: 'GET' }, auth),
      updateProfile: (body: ProfileUpdateRequest) =>
        request<ProfileUpdateResponse>('/v1/profile', { method: 'PATCH', body: JSON.stringify(body) }, auth),
      dashboardToday: () => request<DashboardTodayResponse>('/v1/dashboard/today', { method: 'GET' }, auth),
      getSchedule: () => request<GetScheduleResponse>('/v1/schedule', { method: 'GET' }, auth),
      createSection: (body: SectionMutationRequest) =>
        request<GetScheduleResponse>('/v1/sections', { method: 'POST', body: JSON.stringify(body) }, auth),
      updateSection: (sectionId: string, body: SectionUpdateRequest) =>
        request<GetScheduleResponse>(
          `/v1/sections/${sectionId}`,
          { method: 'PATCH', body: JSON.stringify(body) },
          auth
        ),
      deleteSection: (sectionId: string) =>
        request<DeleteEntityResponse>(`/v1/sections/${sectionId}`, { method: 'DELETE' }, auth),
      getClassroomResume: (sectionId: string) =>
        request<ClassroomResumeResponse>(`/v1/sections/${sectionId}/resume`, { method: 'GET' }, auth),
      listCourses: () => request<CourseListResponse>('/v1/courses', { method: 'GET' }, auth),
      getCourseDetail: (courseId: string) =>
        request<CourseDetailResponse>(`/v1/courses/${courseId}`, { method: 'GET' }, auth),
      createCourse: (body: CourseCreateRequest) =>
        request<CourseDetailResponse>('/v1/courses', { method: 'POST', body: JSON.stringify(body) }, auth),
      updateCourse: (courseId: string, body: CourseUpdateRequest) =>
        request<CourseDetailResponse>(
          `/v1/courses/${courseId}`,
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
        request<CourseDetailResponse>(`/v1/units/${unitId}`, { method: 'PATCH', body: JSON.stringify(body) }, auth),
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
        request<ParseScheduleResponse>('/v1/schedule/import', { method: 'POST', body: JSON.stringify(body) }, auth),
      enqueueParseSchedule: (body: ScheduleImportRequest) =>
        request<AiJobEnqueueResponse>(
          '/v1/ai/parse-schedule/queue',
          { method: 'POST', body: JSON.stringify(body) },
          auth
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
        request<HolidaysUpsertResponse>('/v1/holidays', { method: 'POST', body: JSON.stringify(body) }, auth),
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
