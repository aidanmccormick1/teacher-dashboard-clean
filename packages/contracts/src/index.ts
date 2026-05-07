import { z } from 'zod';

export const UuidSchema = z.string().uuid();
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const IsoTimeSchema = z.string().regex(/^\d{2}:\d{2}$/);

export const MeetingDaySchema = z.enum([
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'A-Day',
  'B-Day'
]);

export const SectionMeetingSchema = z.object({
  day: MeetingDaySchema,
  time: IsoTimeSchema.nullable(),
  room: z.string().nullable()
});

export const ScheduleClassSchema = z.object({
  name: z.string().min(1),
  period: z.string().min(1),
  days: z.array(MeetingDaySchema).min(1),
  time: IsoTimeSchema.nullable(),
  room: z.string().nullable(),
  subject: z.string().min(1),
  grade: z.string().optional().default('')
});

export const AssignmentItemSchema = z.object({
  name: z.string().min(1),
  courseName: z.string().min(1),
  dueDate: IsoDateSchema.nullable(),
  description: z.string().nullable()
});

export const OnboardingRequestSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().nullable(),
  workEmail: z.string().email().nullable(),
  schoolName: z.string().min(1),
  district: z.string().nullable(),
  state: z.string().nullable(),
  role: z.enum(['teacher', 'department_head', 'admin']).default('teacher'),
  subjects: z.array(z.string()).default([]),
  grades: z.array(z.string()).default([])
});

export const OnboardingResponseSchema = z.object({
  userId: UuidSchema,
  schoolId: UuidSchema,
  onboarded: z.literal(true)
});

export const DashboardTodayResponseSchema = z.object({
  date: IsoDateSchema,
  currentClass: z
    .object({
      sectionId: UuidSchema,
      courseName: z.string(),
      sectionName: z.string(),
      meetingTime: IsoTimeSchema.nullable(),
      room: z.string().nullable()
    })
    .nullable(),
  nextClass: z
    .object({
      sectionId: UuidSchema,
      courseName: z.string(),
      sectionName: z.string(),
      meetingTime: IsoTimeSchema.nullable()
    })
    .nullable(),
  todaySchedule: z.array(
    z.object({
      sectionId: UuidSchema,
      courseName: z.string(),
      sectionName: z.string(),
      meetingTime: IsoTimeSchema.nullable(),
      room: z.string().nullable(),
      isInSession: z.boolean()
    })
  ),
  holiday: z
    .object({
      id: UuidSchema,
      date: IsoDateSchema,
      name: z.string()
    })
    .nullable()
});

export const GetScheduleResponseSchema = z.object({
  sections: z.array(
    z.object({
      sectionId: UuidSchema,
      courseId: UuidSchema,
      courseName: z.string(),
      sectionName: z.string(),
      meetings: z.array(SectionMeetingSchema)
    })
  ),
  holidays: z.array(
    z.object({
      id: UuidSchema,
      date: IsoDateSchema,
      name: z.string()
    })
  )
});

export const SectionMutationRequestSchema = z.object({
  courseId: UuidSchema,
  sectionName: z.string().min(1),
  meetings: z.array(SectionMeetingSchema).default([])
});

export const SectionUpdateRequestSchema = z.object({
  sectionName: z.string().min(1).optional(),
  meetings: z.array(SectionMeetingSchema).optional()
});

export const ScheduleImportRequestSchema = z.object({
  text: z.string().min(1).optional(),
  imageBase64: z.string().min(1).optional()
});

export const ScheduleImportResponseSchema = z.object({
  classes: z.array(ScheduleClassSchema),
  assignments: z.array(AssignmentItemSchema)
});

export const HolidaysUpsertRequestSchema = z.object({
  holidays: z.array(
    z.object({
      date: IsoDateSchema,
      name: z.string().min(1)
    })
  )
});

export const HolidaysUpsertResponseSchema = z.object({
  count: z.number().int().nonnegative()
});

export const LessonProgressStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'stopped_at_segment',
  'completed',
  'carried_over',
  'skipped',
  'needs_reteach'
]);

export const LessonProgressUpsertRequestSchema = z.object({
  sectionId: UuidSchema,
  lessonId: UuidSchema,
  status: LessonProgressStatusSchema,
  currentSegmentId: UuidSchema.nullable(),
  stoppedAtSegmentId: UuidSchema.nullable(),
  completedSegmentIds: z.array(UuidSchema),
  carryOverNote: z.string().nullable(),
  lastTaughtDate: IsoDateSchema.nullable()
});

export const LessonProgressUpsertResponseSchema = z.object({
  stateId: UuidSchema,
  updatedAt: z.string()
});

export const ClassNotesUpsertRequestSchema = z.object({
  sectionId: UuidSchema,
  date: IsoDateSchema,
  noteType: z.enum(['raw', 'cleaned']).default('raw'),
  content: z.string().min(1)
});

export const ClassNotesUpsertResponseSchema = z.object({
  noteId: UuidSchema,
  updatedAt: z.string()
});

export const ParseScheduleRequestSchema = z.object({
  text: z.string().min(1).optional(),
  imageBase64: z.string().min(1).optional()
});

export const ParseScheduleResponseSchema = ScheduleImportResponseSchema;

export const GenerateSegmentsRequestSchema = z.object({
  lessonTitle: z.string().min(1),
  objective: z.string().nullable(),
  durationMinutes: z.number().int().positive().default(45)
});

export const GenerateSegmentsResponseSchema = z.object({
  segments: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      durationMinutes: z.number().int().positive()
    })
  )
});

export const GenerateContinuityRequestSchema = z.object({
  lessonTitle: z.string().min(1),
  lastSegmentTitle: z.string().nullable(),
  lastNote: z.string().nullable(),
  previousLessonSummary: z.string().nullable()
});

export const GenerateContinuityResponseSchema = z.object({
  recap: z.string(),
  nextStep: z.string(),
  adjustment: z.string().nullable()
});

export const AiJobTypeSchema = z.enum([
  'parse_schedule',
  'generate_segments',
  'generate_continuity'
]);

export const AiJobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const AiJobControlActionSchema = z.enum(['cancelled', 'requeued']);

export const AiJobEnqueueResponseSchema = z.object({
  jobId: UuidSchema,
  status: AiJobStatusSchema
});

export const AiJobStatusResponseSchema = z.object({
  jobId: UuidSchema,
  type: AiJobTypeSchema,
  status: AiJobStatusSchema,
  output: z.record(z.any()).nullable(),
  error: z.string().nullable(),
  cancelRequested: z.boolean(),
  attemptsMade: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  progressPercent: z.number().int().min(0).max(100),
  canCancel: z.boolean(),
  canRetry: z.boolean()
});

export const AiJobControlResponseSchema = z.object({
  jobId: UuidSchema,
  status: AiJobStatusSchema,
  action: AiJobControlActionSchema
});

export const CourseSummarySchema = z.object({
  id: UuidSchema,
  name: z.string(),
  subject: z.string().nullable(),
  gradeLevel: z.string().nullable(),
  createdAt: z.string()
});

export const CourseListResponseSchema = z.object({
  courses: z.array(CourseSummarySchema)
});

export const CourseCreateRequestSchema = z.object({
  name: z.string().min(1),
  subject: z.string().nullable(),
  gradeLevel: z.string().nullable()
});

export const CourseUpdateRequestSchema = z.object({
  name: z.string().min(1).optional(),
  subject: z.string().nullable().optional(),
  gradeLevel: z.string().nullable().optional()
});

export const SegmentSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  durationMinutes: z.number().int().nullable(),
  orderIndex: z.number().int()
});

export const LessonSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  orderIndex: z.number().int(),
  estimatedDurationMinutes: z.number().int().nullable(),
  segments: z.array(SegmentSchema)
});

export const UnitSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  orderIndex: z.number().int(),
  lessons: z.array(LessonSchema)
});

export const CourseDetailResponseSchema = z.object({
  course: CourseSummarySchema.extend({
    units: z.array(UnitSchema)
  })
});

export const UnitCreateRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  orderIndex: z.number().int().nonnegative().optional()
});

export const UnitUpdateRequestSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  orderIndex: z.number().int().nonnegative().optional()
});

export const LessonCreateRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  estimatedDurationMinutes: z.number().int().positive().nullable(),
  orderIndex: z.number().int().nonnegative().optional()
});

export const LessonUpdateRequestSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  estimatedDurationMinutes: z.number().int().positive().nullable().optional(),
  orderIndex: z.number().int().nonnegative().optional()
});

export const SegmentCreateRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  durationMinutes: z.number().int().positive().nullable(),
  orderIndex: z.number().int().nonnegative().optional()
});

export const SegmentUpdateRequestSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  durationMinutes: z.number().int().positive().nullable().optional(),
  orderIndex: z.number().int().nonnegative().optional()
});

export const ClassroomResumeResponseSchema = z.object({
  section: z.object({
    sectionId: UuidSchema,
    courseId: UuidSchema,
    courseName: z.string(),
    sectionName: z.string()
  }),
  lesson: LessonSchema.nullable(),
  state: z
    .object({
      stateId: UuidSchema,
      lessonId: UuidSchema,
      status: LessonProgressStatusSchema,
      currentSegmentId: UuidSchema.nullable(),
      stoppedAtSegmentId: UuidSchema.nullable(),
      completedSegmentIds: z.array(UuidSchema),
      carryOverNote: z.string().nullable(),
      lastTaughtDate: IsoDateSchema.nullable(),
      updatedAt: z.string()
    })
    .nullable(),
  lastNote: z
    .object({
      noteId: UuidSchema,
      date: IsoDateSchema,
      content: z.string(),
      updatedAt: z.string()
    })
    .nullable()
});

export const DeleteEntityResponseSchema = z.object({
  deleted: z.literal(true)
});

export const CreateUploadUrlRequestSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1)
});

export const CreateUploadUrlResponseSchema = z.object({
  objectKey: z.string(),
  uploadUrl: z.string().url()
});

export const ApiErrorSchema = z.object({
  error: z.string(),
  requestId: z.string().optional()
});

export type OnboardingRequest = z.infer<typeof OnboardingRequestSchema>;
export type OnboardingResponse = z.infer<typeof OnboardingResponseSchema>;
export type DashboardTodayResponse = z.infer<typeof DashboardTodayResponseSchema>;
export type GetScheduleResponse = z.infer<typeof GetScheduleResponseSchema>;
export type SectionMutationRequest = z.infer<typeof SectionMutationRequestSchema>;
export type SectionUpdateRequest = z.infer<typeof SectionUpdateRequestSchema>;
export type ScheduleImportRequest = z.infer<typeof ScheduleImportRequestSchema>;
export type ScheduleImportResponse = z.infer<typeof ScheduleImportResponseSchema>;
export type HolidaysUpsertRequest = z.infer<typeof HolidaysUpsertRequestSchema>;
export type HolidaysUpsertResponse = z.infer<typeof HolidaysUpsertResponseSchema>;
export type LessonProgressUpsertRequest = z.infer<typeof LessonProgressUpsertRequestSchema>;
export type LessonProgressUpsertResponse = z.infer<typeof LessonProgressUpsertResponseSchema>;
export type ClassNotesUpsertRequest = z.infer<typeof ClassNotesUpsertRequestSchema>;
export type ClassNotesUpsertResponse = z.infer<typeof ClassNotesUpsertResponseSchema>;
export type ParseScheduleRequest = z.infer<typeof ParseScheduleRequestSchema>;
export type ParseScheduleResponse = z.infer<typeof ParseScheduleResponseSchema>;
export type GenerateSegmentsRequest = z.infer<typeof GenerateSegmentsRequestSchema>;
export type GenerateSegmentsResponse = z.infer<typeof GenerateSegmentsResponseSchema>;
export type GenerateContinuityRequest = z.infer<typeof GenerateContinuityRequestSchema>;
export type GenerateContinuityResponse = z.infer<typeof GenerateContinuityResponseSchema>;
export type CreateUploadUrlRequest = z.infer<typeof CreateUploadUrlRequestSchema>;
export type CreateUploadUrlResponse = z.infer<typeof CreateUploadUrlResponseSchema>;
export type AiJobEnqueueResponse = z.infer<typeof AiJobEnqueueResponseSchema>;
export type AiJobStatusResponse = z.infer<typeof AiJobStatusResponseSchema>;
export type AiJobControlResponse = z.infer<typeof AiJobControlResponseSchema>;
export type CourseListResponse = z.infer<typeof CourseListResponseSchema>;
export type CourseDetailResponse = z.infer<typeof CourseDetailResponseSchema>;
export type CourseCreateRequest = z.infer<typeof CourseCreateRequestSchema>;
export type CourseUpdateRequest = z.infer<typeof CourseUpdateRequestSchema>;
export type UnitCreateRequest = z.infer<typeof UnitCreateRequestSchema>;
export type UnitUpdateRequest = z.infer<typeof UnitUpdateRequestSchema>;
export type LessonCreateRequest = z.infer<typeof LessonCreateRequestSchema>;
export type LessonUpdateRequest = z.infer<typeof LessonUpdateRequestSchema>;
export type SegmentCreateRequest = z.infer<typeof SegmentCreateRequestSchema>;
export type SegmentUpdateRequest = z.infer<typeof SegmentUpdateRequestSchema>;
export type ClassroomResumeResponse = z.infer<typeof ClassroomResumeResponseSchema>;
export type DeleteEntityResponse = z.infer<typeof DeleteEntityResponseSchema>;
