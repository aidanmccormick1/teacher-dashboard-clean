import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uuid
} from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['teacher', 'department_head', 'admin']);
export const lessonStateStatusEnum = pgEnum('lesson_state_status', [
  'not_started',
  'in_progress',
  'stopped_at_segment',
  'completed',
  'carried_over',
  'skipped',
  'needs_reteach'
]);
export const aiJobStatusEnum = pgEnum('ai_job_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled'
]);
export const classNoteTypeEnum = pgEnum('class_note_type', ['raw', 'cleaned']);
export const calendarEventTypeEnum = pgEnum('calendar_event_type', [
  'no_school',
  'minimum_day',
  'half_day',
  'early_release',
  'late_start',
  'testing_schedule',
  'testing',
  'special_schedule',
  'other_abnormal',
  'other'
]);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  email: text('email').notNull(),
  fullName: text('full_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

export const testAccounts = pgTable(
  'test_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    username: text('username').notNull().unique(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    sessionTokenHash: text('session_token_hash').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_test_accounts_session_token_hash').on(table.sessionTokenHash)]
);

export const schools = pgTable('schools', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  district: text('district'),
  state: text('state'),
  timezone: text('timezone'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

export const teacherProfiles = pgTable(
  'teacher_profiles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    role: userRoleEnum('role').notNull().default('teacher'),
    onboarded: boolean('onboarded').notNull().default(false),
    phone: text('phone'),
    workEmail: text('work_email'),
    subjects: text('subjects').array().notNull().default([]),
    grades: text('grades').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId] }),
    index('idx_teacher_profiles_school').on(table.schoolId)
  ]
);

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    subject: text('subject'),
    gradeLevel: text('grade_level'),
    sortIndex: integer('sort_index').notNull().default(0),
    // `teacherId` remains the canonical owner during this incremental
    // migration. Access is granted through courseCollaborators below, rather
    // than inferred from this field.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index('idx_courses_teacher').on(table.teacherId),
    index('idx_courses_school').on(table.schoolId)
  ]
);

// A curriculum can have many members while retaining one accountable owner.
// Membership is deliberately independent from sections: members each create
// and manage their own scheduled class groups.
export const courseCollaborators = pgTable(
  'course_collaborators',
  {
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    status: text('status').notNull().default('invited'),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    // Ending a course is a personal workspace decision. It must not hide the
    // same shared curriculum from another teacher's active schedule.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // Progress is private by default. A collaborator explicitly enables this
    // before their class-group markers appear in shared pacing comparison.
    shareProgress: boolean('share_progress').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    primaryKey({ columns: [table.courseId, table.userId] }),
    index('idx_course_collaborators_user_status').on(table.userId, table.status),
    index('idx_course_collaborators_course_status').on(table.courseId, table.status)
  ]
);

export const sections = pgTable(
  'sections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    // A class group is local to one teacher even when its curriculum is
    // shared with collaborators.
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index('idx_sections_course').on(table.courseId),
    index('idx_sections_teacher').on(table.teacherId)
  ]
);

export const sectionMeetings = pgTable(
  'section_meetings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    day: text('day').notNull(),
    meetingTime: time('meeting_time'),
    endTime: time('end_time'),
    room: text('room'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_section_meetings_section').on(table.sectionId)]
);

export const schoolHolidays = pgTable(
  'school_holidays',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    name: text('name').notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [unique('uniq_school_holiday_date').on(table.schoolId, table.date)]
);

// A school year and its calendar are shared by teachers at a school. The
// legacy holiday table remains readable while existing installations migrate.
export const schoolYears = pgTable(
  'school_years',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [unique('uniq_school_year_range').on(table.schoolId, table.startDate, table.endDate)]
);

export const schoolCalendarEvents = pgTable(
  'school_calendar_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolYearId: uuid('school_year_id')
      .notNull()
      .references(() => schoolYears.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    type: calendarEventTypeEnum('type').notNull(),
    label: text('label').notNull(),
    sourceText: text('source_text'),
    confidence: integer('confidence'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    unique('uniq_school_calendar_event_date_label').on(table.schoolYearId, table.date, table.label),
    index('idx_school_calendar_events_year_date').on(table.schoolYearId, table.date)
  ]
);

// Overrides only change one teacher's class group on an otherwise shared
// calendar day. A missing override deliberately falls back to manual choice.
export const sectionMeetingOverrides = pgTable(
  'section_meeting_overrides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    // Identifies the scheduled occurrence being changed. `legacy` preserves
    // pre-Phase-2 date-only overrides for schedules that have a single block.
    occurrenceKey: text('occurrence_key').notNull().default('legacy'),
    startTime: time('start_time'),
    endTime: time('end_time'),
    room: text('room'),
    cancelled: boolean('cancelled').notNull().default(false),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    unique('uniq_section_meeting_override_occurrence').on(
      table.sectionId,
      table.date,
      table.occurrenceKey
    )
  ]
);

export const teacherPreferences = pgTable(
  'teacher_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    walkthroughDismissed: boolean('walkthrough_dismissed').notNull().default(false),
    setupStep: text('setup_step').notNull().default('schedule'),
    returnPath: text('return_path'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [primaryKey({ columns: [table.userId] })]
);

export const units = pgTable(
  'units',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    orderIndex: integer('order_index').notNull().default(0),
    plannedStartMeeting: integer('planned_start_meeting'),
    plannedMeetingCount: integer('planned_meeting_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_units_course_order').on(table.courseId, table.orderIndex)]
);

export const lessons = pgTable(
  'lessons',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    lessonPlan: jsonb('lesson_plan')
      .$type<{
        objective: string | null;
        teacherNotes: string | null;
        studentDirections: string | null;
        materials: string | null;
        links: Array<{ title: string; url: string }>;
      }>()
      .notNull()
      .default({
        objective: null,
        teacherNotes: null,
        studentDirections: null,
        materials: null,
        links: []
      }),
    orderIndex: integer('order_index').notNull().default(0),
    estimatedDurationMinutes: integer('estimated_duration_minutes'),
    plannedStartMeeting: integer('planned_start_meeting'),
    plannedMeetingCount: integer('planned_meeting_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_lessons_unit_order').on(table.unitId, table.orderIndex)]
);

export const lessonSegments = pgTable(
  'lesson_segments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    durationMinutes: integer('duration_minutes'),
    stepType: text('step_type'),
    orderIndex: integer('order_index').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_segments_lesson_order').on(table.lessonId, table.orderIndex)]
);

// This is deliberately a separate capability record instead of a lesson flag.
// It keeps the public-link policy small today while allowing future teacher,
// group, and school grants to be added without changing lesson ownership.
export const lessonShares = pgTable(
  'lesson_shares',
  {
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    publicToken: uuid('public_token').defaultRandom().primaryKey(),
    enabled: boolean('enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [unique('uniq_lesson_share_lesson').on(table.lessonId)]
);

export const courseShares = pgTable(
  'course_shares',
  {
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    publicToken: uuid('public_token').defaultRandom().primaryKey(),
    enabled: boolean('enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [unique('uniq_course_share_course').on(table.courseId)]
);

// A compact, human-readable feed for shared-curriculum activity. This is
// intentionally distinct from auditEvents: audit events include operational
// and private actions, while this table only records collaboration-relevant
// curriculum changes and comments.
export const courseActivity = pgTable(
  'course_activity',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id'),
    summary: text('summary').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index('idx_course_activity_course_created').on(table.courseId, table.createdAt),
    index('idx_course_activity_subject').on(table.subjectType, table.subjectId)
  ]
);

// Lesson comments are shared planning discussion, never classroom notes.
// They live beside the curriculum and do not touch any section's progress or
// meeting history.
export const lessonComments = pgTable(
  'lesson_comments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index('idx_lesson_comments_lesson_created').on(table.lessonId, table.createdAt),
    index('idx_lesson_comments_course_created').on(table.courseId, table.createdAt)
  ]
);

export const sectionLessonState = pgTable(
  'section_lesson_state',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    status: lessonStateStatusEnum('status').notNull().default('not_started'),
    currentSegmentId: uuid('current_segment_id').references(() => lessonSegments.id, {
      onDelete: 'set null'
    }),
    stoppedAtSegmentId: uuid('stopped_at_segment_id').references(() => lessonSegments.id, {
      onDelete: 'set null'
    }),
    completedSegmentIds: jsonb('completed_segment_ids').$type<string[]>().notNull().default([]),
    // Progress written before meeting history existed. New meeting-history
    // writes derive their cumulative state from this stable baseline plus
    // occurrence snapshots, rather than from mutable current segments.
    historicalCompletedSegmentIds: jsonb('historical_completed_segment_ids')
      .$type<string[]>()
      .notNull()
      .default([]),
    carryOverNote: text('carry_over_note'),
    lastTaughtDate: date('last_taught_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    unique('uniq_section_lesson_state').on(table.sectionId, table.lessonId),
    index('idx_section_lesson_state_status').on(table.sectionId, table.status)
  ]
);

// Section plans are deliberately sparse: absent values inherit the shared
// Course → Unit → Lesson planning fields. They never copy lesson content.
export const sectionLessonPlans = pgTable(
  'section_lesson_plans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    plannedStartMeeting: integer('planned_start_meeting'),
    plannedMeetingCount: integer('planned_meeting_count'),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    unique('uniq_section_lesson_plan').on(table.sectionId, table.lessonId),
    index('idx_section_lesson_plans_section').on(table.sectionId)
  ]
);

export const sectionPlanOperations = pgTable(
  'section_plan_operations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    previousOverrides: jsonb('previous_overrides')
      .$type<
        Array<{
          lessonId: string;
          plannedStartMeeting: number | null;
          plannedMeetingCount: number | null;
        }>
      >()
      .notNull()
      .default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_section_plan_operations_section').on(table.sectionId, table.createdAt)]
);

// One real teaching occurrence. It records the facts of that day without
// changing the shared lesson or losing the section's cumulative resume state.
export const classMeetings = pgTable(
  'class_meetings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    meetingDate: date('meeting_date').notNull(),
    // `HH:MM` for a scheduled block; `legacy` for records created before
    // occurrence identity was introduced or unscheduled manual meetings.
    occurrenceKey: text('occurrence_key').notNull().default('legacy'),
    scheduledStartTime: time('scheduled_start_time'),
    scheduledEndTime: time('scheduled_end_time'),
    origin: text('origin').notNull().default('scheduled'),
    completedStepIds: jsonb('completed_step_ids').$type<string[]>().notNull().default([]),
    // Immutable-on-write historical rendering data. It deliberately has no FK
    // because current curriculum steps may later be renamed or deleted.
    stepSnapshot:
      jsonb('step_snapshot').$type<
        Array<{ id: string; title: string; order: number; completed: boolean }>
      >(),
    stoppedAfterStepId: uuid('stopped_after_step_id').references(() => lessonSegments.id, {
      onDelete: 'set null'
    }),
    stoppingPointStepId: uuid('stopping_point_step_id'),
    rawNote: text('raw_note'),
    status: text('status').notNull().default('in_progress'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    unique('uniq_class_meeting_occurrence').on(
      table.sectionId,
      table.meetingDate,
      table.occurrenceKey
    ),
    index('idx_class_meetings_section_date').on(table.sectionId, table.meetingDate)
  ]
);

export const classNotes = pgTable(
  'class_notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    noteType: classNoteTypeEnum('note_type').notNull().default('raw'),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    unique('uniq_class_note').on(table.sectionId, table.userId, table.date, table.noteType)
  ]
);

export const aiJobs = pgTable(
  'ai_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    status: aiJobStatusEnum('status').notNull().default('queued'),
    input: jsonb('input').$type<Record<string, unknown>>().notNull(),
    output: jsonb('output').$type<Record<string, unknown>>(),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_ai_jobs_user_status').on(table.userId, table.status)]
);

export const aiOutputs = pgTable(
  'ai_outputs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => aiJobs.id, { onDelete: 'cascade' }),
    outputType: text('output_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_ai_outputs_job').on(table.jobId)]
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    eventType: text('event_type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_audit_events_entity').on(table.entityType, table.entityId)]
);

export const usersRelations = relations(users, ({ many, one }) => ({
  teacherProfile: one(teacherProfiles),
  courses: many(courses),
  classNotes: many(classNotes)
}));

export const coursesRelations = relations(courses, ({ many, one }) => ({
  sections: many(sections),
  units: many(units),
  teacher: one(users, {
    fields: [courses.teacherId],
    references: [users.id]
  })
}));
