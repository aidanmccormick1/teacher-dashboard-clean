import { z } from 'zod';

export const UuidSchema = z.string().uuid();
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const IsoTimeSchema = z.string().regex(/^\d{2}:\d{2}$/);
export const CalendarEventTypeSchema = z.enum([
  'no_school',
  'minimum_day',
  'half_day',
  'early_release',
  'late_start',
  'testing_schedule',
  'special_schedule',
  'other_abnormal',
  // Kept so calendars saved by earlier versions remain readable.
  'testing',
  'other'
]);

export const MeetingDaySchema = z.enum([
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'A-Day',
  'B-Day'
]);

const EndTimeSchema = IsoTimeSchema.nullable().optional().default(null);

function validateMeetingRange(
  value: { time: string | null; endTime: string | null },
  context: z.RefinementCtx
) {
  if (value.time && value.endTime && value.endTime <= value.time) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endTime'],
      message: 'End time must be after start time.'
    });
  }
}

export const SectionMeetingSchema = z
  .object({
    day: MeetingDaySchema,
    // `time` remains the API-compatible start-time field. New UI always labels
    // it Start time; `endTime` is the corresponding persisted end time.
    time: IsoTimeSchema.nullable(),
    endTime: EndTimeSchema,
    room: z.string().nullable()
  })
  .superRefine(validateMeetingRange);

export const ScheduleClassSchema = z
  .object({
    name: z.string().min(1),
    period: z.string().min(1),
    days: z.array(MeetingDaySchema).min(1),
    time: IsoTimeSchema.nullable(),
    endTime: EndTimeSchema,
    room: z.string().nullable(),
    subject: z.string().min(1),
    grade: z.string().optional().default('')
  })
  .superRefine(validateMeetingRange);

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

export const ProfileResponseSchema = z.object({
  user: z.object({
    id: UuidSchema,
    email: z.string(),
    fullName: z.string().nullable()
  }),
  profile: z
    .object({
      role: z.enum(['teacher', 'department_head', 'admin']),
      phone: z.string().nullable(),
      workEmail: z.string().nullable(),
      subjects: z.array(z.string()),
      grades: z.array(z.string()),
      onboarded: z.boolean()
    })
    .nullable(),
  school: z
    .object({
      id: UuidSchema,
      name: z.string(),
      district: z.string().nullable(),
      state: z.string().nullable()
    })
    .nullable()
});

export const ProfileUpdateRequestSchema = OnboardingRequestSchema;
export const ProfileUpdateResponseSchema = ProfileResponseSchema;

export const AccountResetRequestSchema = z.object({
  confirmation: z.literal('RESET')
});

export const AccountResetResponseSchema = z.object({
  reset: z.literal(true)
});

export const DashboardTodayResponseSchema = z.object({
  date: IsoDateSchema,
  currentClass: z
    .object({
      sectionId: UuidSchema,
      courseName: z.string(),
      sectionName: z.string(),
      meetingTime: IsoTimeSchema.nullable(),
      endTime: IsoTimeSchema.nullable(),
      room: z.string().nullable()
    })
    .nullable(),
  nextClass: z
    .object({
      sectionId: UuidSchema,
      courseName: z.string(),
      sectionName: z.string(),
      meetingTime: IsoTimeSchema.nullable(),
      endTime: IsoTimeSchema.nullable()
    })
    .nullable(),
  todaySchedule: z.array(
    z.object({
      sectionId: UuidSchema,
      courseName: z.string(),
      sectionName: z.string(),
      meetingTime: IsoTimeSchema.nullable(),
      endTime: IsoTimeSchema.nullable(),
      room: z.string().nullable(),
      isInSession: z.boolean(),
      status: z.enum(['now', 'upcoming', 'completed', 'unscheduled'])
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
      originalScheduleLabel: z.string().nullable(),
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
  // Relinking only changes the curriculum used by this teacher's local class
  // group. Its meetings, history, progress, and planning overrides remain
  // attached to the group.
  courseId: UuidSchema.optional(),
  sectionName: z.string().min(1).optional(),
  meetings: z.array(SectionMeetingSchema).optional()
});

export const ScheduleImportRequestSchema = z.object({
  text: z.string().min(1).optional(),
  imageBase64: z.string().min(1).optional(),
  fileBase64: z.string().min(1).optional(),
  fileName: z.string().min(1).optional(),
  fileMimeType: z.string().min(1).optional()
});

export const ScheduleImportResponseSchema = z.object({
  classes: z.array(ScheduleClassSchema),
  assignments: z.array(AssignmentItemSchema)
});

export const ScheduleImportCorrectionRequestSchema = z.object({
  classes: z.array(ScheduleClassSchema).min(1),
  assignments: z.array(AssignmentItemSchema),
  instruction: z.string().min(1)
});

export const ScheduleImportApplyRequestSchema = z.object({
  classes: z.array(ScheduleClassSchema).min(1)
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

const CalendarEventSchema = z.object({
  id: UuidSchema.optional(),
  date: IsoDateSchema,
  type: CalendarEventTypeSchema,
  label: z.string().min(1),
  confidence: z.number().int().min(0).max(100).nullable().optional(),
  sourceText: z.string().nullable().optional()
});

export const InstructionalExceptionSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  type: CalendarEventTypeSchema,
  affectsInstruction: z.literal(true),
  scheduleKnown: z.boolean().default(false),
  confidence: z.number().int().min(0).max(100).nullable().optional(),
  sourceText: z.string().nullable().optional(),
  needsReview: z.boolean().default(false)
});

export const IgnoredCalendarEventSchema = z.object({
  title: z.string().min(1),
  date: IsoDateSchema.optional(),
  reason: z.string().min(1),
  sourceText: z.string().nullable().optional()
});

export const SchoolYearSchema = z.object({
  id: UuidSchema,
  startDate: IsoDateSchema,
  endDate: IsoDateSchema
});

export const SchoolCalendarResponseSchema = z.object({
  schoolYear: SchoolYearSchema.nullable(),
  events: z.array(CalendarEventSchema.extend({ id: UuidSchema })),
  isShared: z.literal(true),
  timezone: z.string()
});

export const SchoolTimezoneUpdateRequestSchema = z.object({
  timezone: z.string().min(1).max(100)
});

export const SchoolYearUpsertRequestSchema = z
  .object({ startDate: IsoDateSchema, endDate: IsoDateSchema })
  .refine((value) => value.endDate >= value.startDate, {
    path: ['endDate'],
    message: 'End date must be on or after start date.'
  });

export const CalendarImportRequestSchema = ScheduleImportRequestSchema;
const CalendarOverridePreviewSchema = z.object({
  date: IsoDateSchema,
  classGroup: z.string().min(1),
  startTime: IsoTimeSchema.nullable(),
  endTime: IsoTimeSchema.nullable(),
  room: z.string().nullable(),
  cancelled: z.boolean().default(false)
});
export const CalendarImportResponseSchema = z.object({
  schoolYear: z.object({
    startDate: IsoDateSchema,
    endDate: IsoDateSchema,
    confidence: z.number().int().min(0).max(100).nullable().optional()
  }),
  events: z.array(InstructionalExceptionSchema),
  overrides: z.array(CalendarOverridePreviewSchema).default([]),
  ignoredEvents: z.array(IgnoredCalendarEventSchema).default([]),
  notices: z.array(z.string()).default([])
});

export const MeetingInstancesQuerySchema = z
  .object({
    sectionId: UuidSchema.optional(),
    startDate: IsoDateSchema.optional(),
    endDate: IsoDateSchema.optional()
  })
  .refine((value) => !value.startDate || !value.endDate || value.startDate <= value.endDate, {
    path: ['endDate'],
    message: 'End date must be on or after start date.'
  });

export const CalendarCommitRequestSchema = z.object({
  mode: z.enum(['merge', 'replace']),
  schoolYear: z.object({ startDate: IsoDateSchema, endDate: IsoDateSchema }),
  events: z.array(InstructionalExceptionSchema),
  overrides: z.array(CalendarOverridePreviewSchema).default([]),
  approvedEventKeys: z.array(z.string()).optional()
});

export const CalendarCommitResponseSchema = SchoolCalendarResponseSchema;

export const SectionMeetingOverrideRequestSchema = z
  .object({
    date: IsoDateSchema,
    // Targets a particular recurring block when a section meets twice on a
    // date. Omitted values preserve date-only legacy overrides.
    scheduledStartTime: IsoTimeSchema.nullable().optional(),
    startTime: IsoTimeSchema.nullable(),
    endTime: IsoTimeSchema.nullable(),
    room: z.string().nullable(),
    cancelled: z.boolean().default(false)
  })
  .superRefine((value, context) =>
    validateMeetingRange({ time: value.startTime, endTime: value.endTime }, context)
  );

export const MeetingInstanceSchema = z.object({
  sectionId: UuidSchema,
  courseId: UuidSchema,
  courseName: z.string(),
  sectionName: z.string(),
  date: IsoDateSchema,
  startTime: IsoTimeSchema.nullable(),
  endTime: IsoTimeSchema.nullable(),
  room: z.string().nullable(),
  isAbnormal: z.boolean(),
  calendarEvent: CalendarEventSchema.nullable()
});

export const MeetingInstancesResponseSchema = z.object({
  meetings: z.array(MeetingInstanceSchema),
  schoolYear: SchoolYearSchema.nullable()
});

export const TeacherPreferencesSchema = z.object({
  walkthroughDismissed: z.boolean(),
  setupStep: z.enum(['schedule', 'calendar', 'courses', 'year_plan', 'complete']),
  returnPath: z.string().nullable()
});
export const TeacherPreferencesUpdateRequestSchema = TeacherPreferencesSchema.partial();

export const FeedbackSubmitRequestSchema = z.object({
  type: z.enum(['Confusing', 'Broken', 'Missing feature', 'Nice to have']),
  page: z.string().min(1),
  message: z.string().min(1),
  userAgent: z.string().nullable().optional()
});

export const FeedbackSubmitResponseSchema = z.object({
  feedbackId: UuidSchema,
  saved: z.literal(true)
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

export const ClassMeetingUpsertRequestSchema = z.object({
  sectionId: UuidSchema,
  lessonId: UuidSchema,
  meetingDate: IsoDateSchema,
  scheduledStartTime: z.string().nullable(),
  scheduledEndTime: z.string().nullable(),
  origin: z.enum(['scheduled', 'manual']).default('scheduled'),
  completedStepIds: z.array(UuidSchema),
  rawNote: z.string().nullable(),
  endClass: z.boolean().default(false),
  // Null means the client observed no occurrence. Existing occurrences must
  // use the revision returned by a read or prior save.
  expectedRevision: z.number().int().positive().nullable().optional()
});
export const ClassMeetingStepSnapshotSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  order: z.number().int().nonnegative(),
  completed: z.boolean()
});
export const ClassMeetingResponseSchema = z.object({
  id: UuidSchema,
  status: z.enum(['in_progress', 'ended']),
  completedStepIds: z.array(UuidSchema),
  stoppedAfterStepId: UuidSchema.nullable(),
  rawNote: z.string().nullable(),
  meetingDate: IsoDateSchema,
  scheduledStartTime: IsoTimeSchema.nullable(),
  scheduledEndTime: IsoTimeSchema.nullable(),
  occurrenceKey: z.string(),
  origin: z.enum(['scheduled', 'manual']),
  revision: z.number().int().positive(),
  stepSnapshot: z.array(ClassMeetingStepSnapshotSchema).nullable(),
  stoppingPointStepId: UuidSchema.nullable(),
  endedAt: z.string().nullable(),
  cumulativeCompletedStepIds: z.array(UuidSchema),
  lessonCompleted: z.boolean()
});

export const ClassMeetingLookupQuerySchema = z.object({
  lessonId: UuidSchema,
  meetingDate: IsoDateSchema,
  scheduledStartTime: IsoTimeSchema.nullable().optional(),
  origin: z.enum(['scheduled', 'manual']).default('scheduled')
});
export const ClassMeetingLookupResponseSchema = z.object({
  meeting: ClassMeetingResponseSchema.nullable(),
  historicalCompletedStepIds: z.array(UuidSchema)
});

export const SectionLessonPlanShiftRequestSchema = z.object({
  lessonId: UuidSchema,
  meetingDelta: z
    .number()
    .int()
    .refine((value) => value !== 0, 'meetingDelta cannot be zero')
});
export const SectionLessonPlanResponseSchema = z.object({
  operationId: UuidSchema.nullable(),
  plans: z.array(
    z.object({
      lessonId: UuidSchema,
      plannedStartMeeting: z.number().int().nonnegative().nullable(),
      plannedMeetingCount: z.number().int().positive().nullable(),
      revision: z.number().int().positive()
    })
  )
});
export const SectionPlanningContextQuerySchema = z.object({
  meetingIndex: z.coerce.number().int().nonnegative()
});
export const SectionPlanningContextResponseSchema = z.object({
  planned: z
    .object({
      lessonId: UuidSchema,
      title: z.string(),
      plannedStartMeeting: z.number().int().nonnegative().nullable(),
      plannedMeetingCount: z.number().int().positive().nullable(),
      source: z.enum(['section', 'course'])
    })
    .nullable(),
  actual: z
    .object({
      lessonId: UuidSchema,
      status: LessonProgressStatusSchema,
      completedStepIds: z.array(UuidSchema),
      stoppedAtStepId: UuidSchema.nullable()
    })
    .nullable()
});

export const ParseScheduleRequestSchema = z.object({
  text: z.string().min(1).optional(),
  imageBase64: z.string().min(1).optional(),
  fileBase64: z.string().min(1).optional(),
  fileName: z.string().min(1).optional(),
  fileMimeType: z.string().min(1).optional()
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

export const GenerateUnitDraftRequestSchema = z.object({
  courseName: z.string().min(1),
  gradeLevel: z.string().nullable(),
  prompt: z.string().min(8),
  meetingCount: z.number().int().min(2).max(30).default(6)
});

export const GenerateUnitDraftResponseSchema = z.object({
  unit: z.object({
    title: z.string(),
    description: z.string(),
    meetingCount: z.number().int().positive(),
    lessons: z.array(
      z.object({
        title: z.string(),
        description: z.string(),
        estimatedDurationMinutes: z.number().int().positive(),
        objective: z.string().nullable().optional(),
        materials: z.string().nullable().optional(),
        steps: z
          .array(
            z.object({
              title: z.string(),
              description: z.string(),
              durationMinutes: z.number().int().positive(),
              stepType: z.string().nullable().optional()
            })
          )
          .default([])
      })
    )
  })
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
  'parse_school_calendar',
  'generate_segments',
  'generate_continuity',
  'generate_unit_draft'
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
  curriculumId: UuidSchema,
  curriculumName: z.string(),
  relationshipType: z.enum(['shared', 'independent']),
  name: z.string(),
  subject: z.string().nullable(),
  gradeLevel: z.string().nullable(),
  sortIndex: z.number().int(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  accessRole: z.enum(['owner', 'editor']),
  lifecycle: z.enum(['active', 'unlinked', 'ended']),
  linkedClassGroupCount: z.number().int().nonnegative()
});

export const CourseListResponseSchema = z.object({
  courses: z.array(CourseSummarySchema)
});

export const CourseCreateRequestSchema = z.object({
  name: z.string().min(1),
  subject: z.string().nullable(),
  gradeLevel: z.string().nullable(),
  sourceCourseId: UuidSchema.optional()
});

export const CourseDuplicateRequestSchema = z.object({ name: z.string().min(1) });
export const CourseCurriculumCopyRequestSchema = z.object({ sourceCourseId: UuidSchema });
export const CourseDeleteRequestSchema = z.object({ confirmation: z.literal('DELETE') });
export const CourseShareUpdateRequestSchema = z.object({ enabled: z.boolean() });
export const CourseShareResponseSchema = z.object({
  enabled: z.boolean(),
  token: z.string().uuid().nullable()
});

export const CourseCollaboratorSchema = z.object({
  userId: UuidSchema,
  email: z.string().email(),
  fullName: z.string().nullable(),
  role: z.enum(['owner', 'editor']),
  status: z.enum(['invited', 'accepted']),
  invitedByUserId: UuidSchema.nullable(),
  joinedAt: z.string().nullable()
});

export const CourseCollaboratorInviteRequestSchema = z.object({
  email: z.string().email()
});

export const CourseOwnershipTransferRequestSchema = z.object({
  email: z.string().email()
});

export const CourseCollaboratorsResponseSchema = z.object({
  collaborators: z.array(CourseCollaboratorSchema)
});

export const CourseInvitationSchema = z.object({
  course: CourseSummarySchema,
  invitedBy: z.object({
    userId: UuidSchema,
    fullName: z.string().nullable(),
    email: z.string().email()
  })
});

export const CourseInvitationsResponseSchema = z.object({
  invitations: z.array(CourseInvitationSchema)
});

export const CourseInvitationAcceptRequestSchema = z.object({
  mode: z.enum(['collaborate', 'copy']),
  name: z.string().min(1)
});

export const CourseActivitySchema = z.object({
  id: UuidSchema,
  action: z.string(),
  summary: z.string(),
  subjectType: z.enum(['course', 'unit', 'lesson']),
  subjectId: UuidSchema.nullable(),
  actor: z
    .object({
      userId: UuidSchema,
      fullName: z.string().nullable(),
      email: z.string().email()
    })
    .nullable(),
  createdAt: z.string()
});

export const CourseActivityResponseSchema = z.object({
  activity: z.array(CourseActivitySchema)
});

export const LessonCommentSchema = z.object({
  id: UuidSchema,
  courseId: UuidSchema,
  lessonId: UuidSchema,
  body: z.string(),
  author: z
    .object({
      userId: UuidSchema,
      fullName: z.string().nullable(),
      email: z.string().email()
    })
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const LessonCommentsResponseSchema = z.object({
  comments: z.array(LessonCommentSchema)
});

export const LessonCommentCreateRequestSchema = z.object({
  body: z.string().trim().min(1).max(10_000)
});

export const CoursePacingSharingUpdateRequestSchema = z.object({ enabled: z.boolean() });

export const CoursePacingResponseSchema = z.object({
  sharingEnabled: z.boolean(),
  participants: z.array(
    z.object({
      userId: UuidSchema,
      fullName: z.string().nullable(),
      email: z.string().email(),
      isCurrentUser: z.boolean(),
      classGroups: z.array(
        z.object({
          sectionId: UuidSchema,
          sectionName: z.string(),
          lessonId: UuidSchema.nullable(),
          lessonTitle: z.string().nullable(),
          lessonOrderIndex: z.number().int().nullable(),
          status: LessonProgressStatusSchema.nullable(),
          lastTaughtDate: IsoDateSchema.nullable()
        })
      )
    })
  )
});

export const CourseUpdateRequestSchema = z.object({
  name: z.string().min(1).optional(),
  subject: z.string().nullable().optional(),
  gradeLevel: z.string().nullable().optional(),
  sortIndex: z.number().int().nonnegative().optional()
});

export const CourseOrderUpdateRequestSchema = z.object({
  courseIds: z
    .array(UuidSchema)
    .min(1)
    .refine((courseIds) => new Set(courseIds).size === courseIds.length, {
      message: 'Each course may appear only once.'
    })
});

export const SegmentSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  durationMinutes: z.number().int().nullable(),
  stepType: z.string().nullable().optional(),
  orderIndex: z.number().int()
});

export const LessonPlanSchema = z.object({
  objective: z.string().nullable(),
  teacherNotes: z.string().nullable(),
  studentDirections: z.string().nullable(),
  materials: z.string().nullable(),
  links: z.array(
    z.object({
      title: z.string().min(1),
      url: z.string().url()
    })
  )
});

export const LessonSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  lessonPlan: LessonPlanSchema,
  orderIndex: z.number().int(),
  estimatedDurationMinutes: z.number().int().nullable(),
  plannedStartMeeting: z.number().int().nonnegative().nullable(),
  plannedMeetingCount: z.number().int().positive().nullable(),
  segments: z.array(SegmentSchema)
});

export const UnitSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  orderIndex: z.number().int(),
  plannedStartMeeting: z.number().int().nonnegative().nullable(),
  plannedMeetingCount: z.number().int().positive().nullable(),
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
  orderIndex: z.number().int().nonnegative().optional(),
  plannedStartMeeting: z.number().int().nonnegative().nullable().optional(),
  plannedMeetingCount: z.number().int().positive().nullable().optional()
});

export const UnitUpdateRequestSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  orderIndex: z.number().int().nonnegative().optional(),
  plannedStartMeeting: z.number().int().nonnegative().nullable().optional(),
  plannedMeetingCount: z.number().int().positive().nullable().optional()
});

export const LessonCreateRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  lessonPlan: LessonPlanSchema.optional(),
  estimatedDurationMinutes: z.number().int().positive().nullable(),
  orderIndex: z.number().int().nonnegative().optional(),
  plannedStartMeeting: z.number().int().nonnegative().nullable().optional(),
  plannedMeetingCount: z.number().int().positive().nullable().optional()
});

export const LessonUpdateRequestSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  lessonPlan: LessonPlanSchema.optional(),
  estimatedDurationMinutes: z.number().int().positive().nullable().optional(),
  orderIndex: z.number().int().nonnegative().optional(),
  unitId: UuidSchema.optional(),
  plannedStartMeeting: z.number().int().nonnegative().nullable().optional(),
  plannedMeetingCount: z.number().int().positive().nullable().optional()
});

// A confirmed Year Plan range is always expressed in effective meeting
// indices, never in calendar days. This keeps course curriculum shared while
// letting the selected section supply the date mapping in the UI.
export const CurriculumRangeCreateRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('unit'),
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    plannedStartMeeting: z.number().int().nonnegative(),
    plannedMeetingCount: z.number().int().positive(),
    lessonTitles: z.array(z.string().min(1)).max(30).default([])
  }),
  z.object({
    kind: z.literal('lessons'),
    unitId: UuidSchema,
    plannedStartMeeting: z.number().int().nonnegative(),
    plannedMeetingCount: z.number().int().positive(),
    lessonTitles: z.array(z.string().min(1)).min(1).max(30)
  })
]);

export const SegmentCreateRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  durationMinutes: z.number().int().positive().nullable(),
  stepType: z.string().max(40).nullable().optional(),
  orderIndex: z.number().int().nonnegative().optional()
});

export const SegmentUpdateRequestSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  durationMinutes: z.number().int().positive().nullable().optional(),
  stepType: z.string().max(40).nullable().optional(),
  orderIndex: z.number().int().nonnegative().optional()
});

// Reordering is deliberately an all-or-nothing operation. A pair of independent
// order-index updates can leave a lesson in an ambiguous order if the second
// request fails.
export const SegmentReorderRequestSchema = z.object({
  segmentIds: z.array(UuidSchema).min(1)
});

export const LessonShareUpdateRequestSchema = z.object({ enabled: z.boolean() });
export const LessonShareResponseSchema = z.object({
  enabled: z.boolean(),
  token: z.string().uuid().nullable()
});
export const LessonWorkspaceResponseSchema = z.object({
  course: z.object({ id: UuidSchema, name: z.string() }),
  unit: z.object({ id: UuidSchema, title: z.string() }),
  lesson: LessonSchema,
  sections: z.array(
    z.object({
      id: UuidSchema,
      name: z.string(),
      status: LessonProgressStatusSchema.nullable(),
      lastTaughtDate: IsoDateSchema.nullable()
    })
  ),
  share: LessonShareResponseSchema
});
export const PublicLessonResponseSchema = z.object({
  courseName: z.string(),
  unitTitle: z.string(),
  lesson: z.object({
    title: z.string(),
    description: z.string().nullable(),
    objective: z.string().nullable(),
    materials: z.string().nullable(),
    links: LessonPlanSchema.shape.links,
    estimatedDurationMinutes: z.number().int().positive().nullable(),
    steps: z.array(
      z.object({
        title: z.string(),
        description: z.string().nullable(),
        durationMinutes: z.number().int().positive().nullable(),
        stepType: z.string().nullable()
      })
    )
  })
});

export const PublicCurriculumResponseSchema = z.object({
  course: z.object({
    name: z.string(),
    subject: z.string().nullable(),
    gradeLevel: z.string().nullable(),
    units: z.array(
      z.object({
        title: z.string(),
        description: z.string().nullable(),
        lessons: z.array(
          z.object({
            title: z.string(),
            description: z.string().nullable(),
            objective: z.string().nullable(),
            materials: z.string().nullable(),
            studentDirections: z.string().nullable(),
            estimatedDurationMinutes: z.number().int().positive().nullable(),
            steps: z.array(
              z.object({
                title: z.string(),
                description: z.string().nullable(),
                durationMinutes: z.number().int().positive().nullable(),
                stepType: z.string().nullable()
              })
            )
          })
        )
      })
    )
  })
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
  progress: z.array(z.object({ lessonId: UuidSchema, status: LessonProgressStatusSchema })),
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
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;
export type AccountResetRequest = z.infer<typeof AccountResetRequestSchema>;
export type AccountResetResponse = z.infer<typeof AccountResetResponseSchema>;
export type ProfileUpdateRequest = z.infer<typeof ProfileUpdateRequestSchema>;
export type ProfileUpdateResponse = z.infer<typeof ProfileUpdateResponseSchema>;
export type DashboardTodayResponse = z.infer<typeof DashboardTodayResponseSchema>;
export type GetScheduleResponse = z.infer<typeof GetScheduleResponseSchema>;
export type SectionMutationRequest = z.infer<typeof SectionMutationRequestSchema>;
export type SectionUpdateRequest = z.infer<typeof SectionUpdateRequestSchema>;
export type ScheduleImportRequest = z.infer<typeof ScheduleImportRequestSchema>;
export type ScheduleImportResponse = z.infer<typeof ScheduleImportResponseSchema>;
export type ScheduleImportCorrectionRequest = z.infer<typeof ScheduleImportCorrectionRequestSchema>;
export type ScheduleImportApplyRequest = z.infer<typeof ScheduleImportApplyRequestSchema>;
export type HolidaysUpsertRequest = z.infer<typeof HolidaysUpsertRequestSchema>;
export type HolidaysUpsertResponse = z.infer<typeof HolidaysUpsertResponseSchema>;
export type SchoolCalendarResponse = z.infer<typeof SchoolCalendarResponseSchema>;
export type SchoolYearUpsertRequest = z.infer<typeof SchoolYearUpsertRequestSchema>;
export type CalendarImportRequest = z.infer<typeof CalendarImportRequestSchema>;
export type CalendarImportResponse = z.infer<typeof CalendarImportResponseSchema>;
export type CalendarCommitRequest = z.infer<typeof CalendarCommitRequestSchema>;
export type CalendarCommitResponse = z.infer<typeof CalendarCommitResponseSchema>;
export type SectionMeetingOverrideRequest = z.infer<typeof SectionMeetingOverrideRequestSchema>;
export type MeetingInstancesResponse = z.infer<typeof MeetingInstancesResponseSchema>;
export type MeetingInstancesQuery = z.infer<typeof MeetingInstancesQuerySchema>;
export type TeacherPreferences = z.infer<typeof TeacherPreferencesSchema>;
export type TeacherPreferencesUpdateRequest = z.infer<typeof TeacherPreferencesUpdateRequestSchema>;
export type FeedbackSubmitRequest = z.infer<typeof FeedbackSubmitRequestSchema>;
export type FeedbackSubmitResponse = z.infer<typeof FeedbackSubmitResponseSchema>;
export type LessonProgressUpsertRequest = z.infer<typeof LessonProgressUpsertRequestSchema>;
export type LessonProgressUpsertResponse = z.infer<typeof LessonProgressUpsertResponseSchema>;
export type ClassNotesUpsertRequest = z.infer<typeof ClassNotesUpsertRequestSchema>;
export type ClassNotesUpsertResponse = z.infer<typeof ClassNotesUpsertResponseSchema>;
export type ParseScheduleRequest = z.infer<typeof ParseScheduleRequestSchema>;
export type ParseScheduleResponse = z.infer<typeof ParseScheduleResponseSchema>;
export type GenerateSegmentsRequest = z.infer<typeof GenerateSegmentsRequestSchema>;
export type GenerateSegmentsResponse = z.infer<typeof GenerateSegmentsResponseSchema>;
export type GenerateUnitDraftRequest = z.infer<typeof GenerateUnitDraftRequestSchema>;
export type GenerateUnitDraftResponse = z.infer<typeof GenerateUnitDraftResponseSchema>;
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
export type CourseDuplicateRequest = z.infer<typeof CourseDuplicateRequestSchema>;
export type CourseCurriculumCopyRequest = z.infer<typeof CourseCurriculumCopyRequestSchema>;
export type CourseDeleteRequest = z.infer<typeof CourseDeleteRequestSchema>;
export type CourseShareResponse = z.infer<typeof CourseShareResponseSchema>;
export type CourseCollaboratorInviteRequest = z.infer<typeof CourseCollaboratorInviteRequestSchema>;
export type CourseOwnershipTransferRequest = z.infer<typeof CourseOwnershipTransferRequestSchema>;
export type CourseCollaboratorsResponse = z.infer<typeof CourseCollaboratorsResponseSchema>;
export type CourseInvitationsResponse = z.infer<typeof CourseInvitationsResponseSchema>;
export type CourseInvitationAcceptRequest = z.infer<typeof CourseInvitationAcceptRequestSchema>;
export type CourseActivityResponse = z.infer<typeof CourseActivityResponseSchema>;
export type LessonCommentsResponse = z.infer<typeof LessonCommentsResponseSchema>;
export type LessonCommentCreateRequest = z.infer<typeof LessonCommentCreateRequestSchema>;
export type CoursePacingResponse = z.infer<typeof CoursePacingResponseSchema>;
export type CoursePacingSharingUpdateRequest = z.infer<
  typeof CoursePacingSharingUpdateRequestSchema
>;
export type CourseUpdateRequest = z.infer<typeof CourseUpdateRequestSchema>;
export type CourseOrderUpdateRequest = z.infer<typeof CourseOrderUpdateRequestSchema>;
export type UnitCreateRequest = z.infer<typeof UnitCreateRequestSchema>;
export type UnitUpdateRequest = z.infer<typeof UnitUpdateRequestSchema>;
export type LessonCreateRequest = z.infer<typeof LessonCreateRequestSchema>;
export type LessonUpdateRequest = z.infer<typeof LessonUpdateRequestSchema>;
export type CurriculumRangeCreateRequest = z.infer<typeof CurriculumRangeCreateRequestSchema>;
export type LessonWorkspaceResponse = z.infer<typeof LessonWorkspaceResponseSchema>;
export type LessonShareResponse = z.infer<typeof LessonShareResponseSchema>;
export type PublicLessonResponse = z.infer<typeof PublicLessonResponseSchema>;
export type PublicCurriculumResponse = z.infer<typeof PublicCurriculumResponseSchema>;
export type SegmentCreateRequest = z.infer<typeof SegmentCreateRequestSchema>;
export type SegmentUpdateRequest = z.infer<typeof SegmentUpdateRequestSchema>;
export type SegmentReorderRequest = z.infer<typeof SegmentReorderRequestSchema>;
export type ClassroomResumeResponse = z.infer<typeof ClassroomResumeResponseSchema>;
export type ClassMeetingUpsertRequest = z.infer<typeof ClassMeetingUpsertRequestSchema>;
export type ClassMeetingResponse = z.infer<typeof ClassMeetingResponseSchema>;
export type ClassMeetingLookupQuery = z.infer<typeof ClassMeetingLookupQuerySchema>;
export type ClassMeetingLookupResponse = z.infer<typeof ClassMeetingLookupResponseSchema>;
export type SectionLessonPlanShiftRequest = z.infer<typeof SectionLessonPlanShiftRequestSchema>;
export type SectionLessonPlanResponse = z.infer<typeof SectionLessonPlanResponseSchema>;
export type SectionPlanningContextQuery = z.infer<typeof SectionPlanningContextQuerySchema>;
export type SectionPlanningContextResponse = z.infer<typeof SectionPlanningContextResponseSchema>;
export type DeleteEntityResponse = z.infer<typeof DeleteEntityResponseSchema>;
