import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  CalendarImportExtractionSchema,
  CalendarImportResponseSchema,
  GenerateContinuityResponseSchema,
  GenerateSegmentsResponseSchema,
  ParseScheduleResponseSchema
} from '@teacheros/contracts';
import { aiJobs, aiOutputs, db, sections } from '@teacheros/db';

import { runStructuredPrompt } from './openai.js';

type AiQueuePayload = {
  jobId: string;
};

export type AiWorkerConfig = {
  redisUrl: string;
  openAiApiKey: string;
  modelParseSchedule: string;
  reasoningEffortParseSchedule: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  modelGenerateSegments: string;
  modelContinuity: string;
};

class CancelledError extends Error {
  constructor() {
    super('Cancelled by user');
  }
}

type ScheduleImportInput = {
  text?: string;
  imageBase64?: string;
  fileBase64?: string;
  fileName?: string;
  fileMimeType?: string;
};
type CalendarImportInput = ScheduleImportInput;

function scheduleImportFileDataUrl(input: ScheduleImportInput): string | undefined {
  if (input.fileBase64) {
    if (input.fileBase64.startsWith('data:')) return input.fileBase64;
    return `data:${input.fileMimeType ?? 'application/pdf'};base64,${input.fileBase64}`;
  }

  if (input.imageBase64) {
    if (input.imageBase64.startsWith('data:')) return input.imageBase64;
    return `data:${input.fileMimeType ?? 'image/png'};base64,${input.imageBase64}`;
  }

  return undefined;
}

const scheduleCourseGroupingInstructions = [
  'A COURSE is the shared subject and level or grade. A CLASS GROUP is the cohort taught within that course. Put the complete course in `name` and only the class-group label in `period`.',
  'A subject plus its number is the course name. This includes Spanish 5, Spanish 6, Spanish 7, Spanish 8, Math 5, Math 6, and similarly numbered subjects.',
  'For example: Spanish 5A => `name: "Spanish 5"`, `period: "Group A"`; Spanish 5 Group C => `name: "Spanish 5"`, `period: "Group C"`; Math 6 with no subgroup => `name: "Math 6"`, `period: "Main section"`.',
  'Never return `name: "Spanish"` with `period: "5"`, and never make Spanish 5, Spanish 6, Spanish 7, or Spanish 8 into groups below one Spanish course. They are separate courses. The same rule applies to every numbered subject.',
  'A/B/C suffixes and words such as Block, Section, Group, or Class identify a class group only after the complete course name has been removed. A bell-period or grid row identifies when a group meets and is never a class-group label.',
  'For pasted text, a course heading applies to the group lines beneath it until the next course heading. Repeated course names that differ only by case, punctuation, word order, or a group suffix represent one course.',
  'Never turn a weekday, time, room, bell-period row, note, or list heading into a course. Every returned course and group must be supported by the source. Omit unreadable text instead of inventing a plausible name.'
].join('\n');

function scheduleImportUserPrompt(input: ScheduleImportInput): string {
  if (input.text) {
    return [
      'Parse this teacher schedule and assignments.',
      scheduleCourseGroupingInstructions,
      'For example, Spanish 5A, Spanish 5B, and Spanish 5C are one course named Spanish 5; Pre-Calculus Block 1, Block 3, and Block 4 are one course named Pre-Calculus.',
      'A schedule may show the same class group on more than one day at different times. Emit one class object per meeting occurrence, but repeat the exact same course name and class-group label for each occurrence.',
      'The `period` field is the class-group label, not a bell-period/grid row. Spanish 5B on Monday at 08:10 to 09:05 and Thursday at 13:35 to 14:30 must use `name: "Spanish 5"` and `period: "Group B"`; only the day and time range change.',
      'For a visual grid, identify weekday columns and time-row boundaries before scanning every nonempty teaching cell. A spanning cell starts at its top boundary and ends at its bottom boundary. Return `time` and `endTime` as 24-hour HH:MM. Use null only when a boundary is not visible, and never replace a visible end time with a guessed duration.',
      'A shorthand such as 7B means Spanish 7, Group B; text in parentheses is the room/location. Do not omit a group just because another group from that grade appears elsewhere.',
      'Keep every class group and all of its meeting times. Return JSON only.',
      '',
      input.text
    ].join('\n');
  }
  if (input.fileMimeType === 'application/pdf' || input.fileName?.toLowerCase().endsWith('.pdf')) {
    return `Parse the uploaded PDF schedule. Identify its weekday columns and time boundaries, then extract every teaching class and visible start/end time.\n${scheduleCourseGroupingInstructions}\nReturn JSON only.`;
  }
  return `Parse the uploaded schedule image. Identify its weekday columns and time-row boundaries, then scan every teaching cell and capture its visible start/end time.\n${scheduleCourseGroupingInstructions}\nReturn JSON only.`;
}

function scheduleImportAuditPrompt(
  input: ScheduleImportInput,
  initialExtraction: z.infer<typeof ParseScheduleResponseSchema>
): string {
  return [
    'Audit the attached visual schedule against the candidate extraction below. Return a complete corrected JSON schedule.',
    scheduleCourseGroupingInstructions,
    'Check the weekday headers, time-row boundaries, and every nonempty teaching cell. Keep a candidate only when the source supports it, remove invented records, add a group only when its label is visible, and correct every course, group, day, start time, end time, or room that conflicts with the source.',
    'Use the visible top and bottom boundaries of a spanning cell for `time` and `endTime`. Use null only when an ending boundary is not visible. Do not infer a standard class duration.',
    'Keep the exact same `name` and `period` for separate meeting occurrences of one class group. Ignore non-teaching blocks.',
    '',
    `Candidate extraction: ${JSON.stringify(initialExtraction)}`,
    input.text ? `\nOriginal text, if helpful:\n${input.text}` : ''
  ].join('\n');
}

function calendarImportPrompt(input: CalendarImportInput, classGroups: string[]): string {
  const instructions = [
    'You are not extracting every event from an academic calendar. You are identifying the instructional school year and events that affect normal student instruction.',
    'First determine the actual instructional school-year boundaries. Find the first instructional day for students and the last instructional day for students. Prioritize explicit wording such as First Day of School, First Day for Students, Students Begin, Classes Begin, School Begins, Last Day of School, Last Day for Students, Classes End, and Final Instructional Day.',
    'Do not use graduation, teacher checkout, teacher work after students finish, or administrative dates as the final day unless the source explicitly says students attend.',
    'Return those boundaries as schoolYear, with ISO dates, confidence, and compact source excerpts. Return events only inside those boundaries.',
    'Return one logical event per date range; never expand a break into daily rows. Only return events inside the instructional-year boundaries that cancel student instruction or alter the normal student schedule.',
    'Use no_school only when students do not attend. Use minimum_day, half_day, early_release, late_start, testing_schedule, special_schedule, or other_abnormal for altered school days. Do not invent bell times.',
    'Ignore ceremonies, extracurriculars, parent events, staff-only meetings, fundraisers, administrative deadlines, report cards, and informational events that do not affect regular student instruction. Teacher/staff days matter only when students do not attend or normal classes are affected.',
    'Use Classes Resume to understand a break boundary, but do not return it as an event. First and last instructional days are boundaries, never events.',
    'If a date such as Faculty Development Day may affect instruction but the document does not establish whether students attend, return it with needsReview true. Otherwise do not make the teacher review clear information.',
    'For each ignored event, return its title, date if known, and a concise reason.',
    'For every returned event include title, startDate, endDate, type, affectsInstruction true, scheduleKnown, confidence, needsReview, and a compact source excerpt.',
    classGroups.length
      ? `If an alternate schedule explicitly identifies one of these Class Groups, emit a date-specific override for it: ${classGroups.join(', ')}.`
      : 'Do not emit an override unless the alternate schedule identifies a class group.',
    'Return JSON only.'
  ];
  return input.text ? [...instructions, '', input.text].join('\n') : instructions.join('\n');
}

export function createAiJobsWorker(config: AiWorkerConfig): Worker<AiQueuePayload> {
  const {
    redisUrl,
    openAiApiKey,
    modelParseSchedule,
    reasoningEffortParseSchedule,
    modelGenerateSegments,
    modelContinuity
  } = config;
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null
  });

  return new Worker<AiQueuePayload>(
    'ai-jobs',
    async (job) => {
      const [aiJob] = await db
        .select({
          id: aiJobs.id,
          userId: aiJobs.userId,
          type: aiJobs.type,
          status: aiJobs.status,
          cancelRequested: aiJobs.cancelRequested,
          input: aiJobs.input
        })
        .from(aiJobs)
        .where(eq(aiJobs.id, job.data.jobId))
        .limit(1);

      if (!aiJob) throw new Error(`AI job not found: ${job.data.jobId}`);

      const cancelJob = async () => {
        await db
          .update(aiJobs)
          .set({
            status: 'cancelled',
            cancelRequested: true,
            error: 'Cancelled by user',
            updatedAt: new Date()
          })
          .where(eq(aiJobs.id, aiJob.id));
        await job.updateProgress(100);
      };

      const throwIfCancelled = async () => {
        const [latest] = await db
          .select({
            status: aiJobs.status,
            cancelRequested: aiJobs.cancelRequested
          })
          .from(aiJobs)
          .where(eq(aiJobs.id, aiJob.id))
          .limit(1);

        if (!latest) {
          throw new Error(`AI job disappeared during execution: ${aiJob.id}`);
        }

        if (latest.cancelRequested || latest.status === 'cancelled') {
          await cancelJob();
          throw new CancelledError();
        }
      };

      if (aiJob.cancelRequested || aiJob.status === 'cancelled') {
        await cancelJob();
        return;
      }

      await db
        .update(aiJobs)
        .set({
          status: 'running',
          error: null,
          updatedAt: new Date()
        })
        .where(eq(aiJobs.id, aiJob.id));

      await job.updateProgress(10);

      try {
        await throwIfCancelled();
        await job.updateProgress(35);

        let output: Record<string, unknown>;
        if (aiJob.type === 'parse_schedule') {
          const input = aiJob.input as ScheduleImportInput;
          const fileDataUrl = scheduleImportFileDataUrl(input);
          const initialOutput = await runStructuredPrompt<
            z.infer<typeof ParseScheduleResponseSchema>
          >({
            apiKey: openAiApiKey,
            model: modelParseSchedule,
            reasoningEffort: reasoningEffortParseSchedule,
            schemaName: 'parse_schedule',
            schema: ParseScheduleResponseSchema,
            systemPrompt: `Extract classes and assignments from teacher schedules. Return JSON only and skip non-teaching events. ${scheduleCourseGroupingInstructions} Build one record for each distinct course, class group, start time, end time, and room combination. Combine days only when those values match. For grid images, identify weekday columns and time-row boundaries before auditing every nonempty teaching cell. A cell that spans rows starts at its top boundary and ends at its bottom boundary. Return \`time\` and \`endTime\` as 24-hour HH:MM strings or null only when the corresponding boundary is not visible. Never replace a visible end time with a guessed duration. Before returning, verify that every visible class group appears and each non-null end time is later than its start time.`,
            userPrompt: scheduleImportUserPrompt(input),
            fileDataUrl,
            fileName: input.fileName
          });
          if (fileDataUrl) {
            await throwIfCancelled();
            await job.updateProgress(60);
            output = await runStructuredPrompt<z.infer<typeof ParseScheduleResponseSchema>>({
              apiKey: openAiApiKey,
              model: modelParseSchedule,
              reasoningEffort: reasoningEffortParseSchedule,
              schemaName: 'parse_schedule_audit',
              schema: ParseScheduleResponseSchema,
              systemPrompt: `Audit teacher schedules against their source and return JSON only. ${scheduleCourseGroupingInstructions}`,
              userPrompt: scheduleImportAuditPrompt(input, initialOutput),
              fileDataUrl,
              fileName: input.fileName
            });
          } else {
            output = initialOutput;
          }
        } else if (aiJob.type === 'parse_school_calendar') {
          const input = aiJob.input as CalendarImportInput;
          const classGroups = await db
            .select({ name: sections.name })
            .from(sections)
            .where(eq(sections.teacherId, aiJob.userId));
          const parsedCalendar = await runStructuredPrompt<
            z.infer<typeof CalendarImportExtractionSchema>
          >({
            apiKey: openAiApiKey,
            model: modelParseSchedule,
            reasoningEffort: 'low',
            schemaName: 'school_calendar_import',
            schema: CalendarImportExtractionSchema,
            systemPrompt:
              'You are a careful school calendar reader. Extract only evidence visible in the teacher supplied calendar.',
            userPrompt: calendarImportPrompt(
              input,
              classGroups.map((group) => group.name)
            ),
            fileDataUrl: scheduleImportFileDataUrl(input),
            fileName: input.fileName
          });
          output = CalendarImportResponseSchema.parse({
            ...parsedCalendar,
            ignoredEvents: parsedCalendar.ignoredEvents.map(({ date, ...event }) => ({
              ...event,
              ...(date ? { date } : {})
            }))
          });
        } else if (aiJob.type === 'generate_segments') {
          const input = aiJob.input as {
            lessonTitle: string;
            objective: string | null;
            durationMinutes: number;
          };
          output = await runStructuredPrompt({
            apiKey: openAiApiKey,
            model: modelGenerateSegments,
            schemaName: 'generate_segments',
            schema: GenerateSegmentsResponseSchema,
            systemPrompt:
              'Generate practical, classroom-ready lesson segments with realistic durations and concise descriptions. Write the lesson plan and teacher-facing directions in English, even when the course teaches another language such as Spanish. Use target-language words or examples only where instruction requires them.',
            userPrompt: `Lesson title: ${input.lessonTitle}\nObjective: ${input.objective ?? 'None'}\nTotal minutes: ${input.durationMinutes}`
          });
        } else if (aiJob.type === 'generate_continuity') {
          const input = aiJob.input as {
            lessonTitle: string;
            lastSegmentTitle: string | null;
            lastNote: string | null;
            previousLessonSummary: string | null;
          };
          output = await runStructuredPrompt({
            apiKey: openAiApiKey,
            model: modelContinuity,
            schemaName: 'generate_continuity',
            schema: GenerateContinuityResponseSchema,
            systemPrompt:
              'You are helping a teacher continue the next class smoothly. Keep output concise and practical. Write all teacher-facing guidance in English, even when the course teaches another language such as Spanish.',
            userPrompt: `Lesson: ${input.lessonTitle}\nLast segment: ${input.lastSegmentTitle ?? 'Unknown'}\nLast note: ${input.lastNote ?? 'None'}\nPrevious summary: ${input.previousLessonSummary ?? 'None'}`
          });
        } else {
          throw new Error(`Unsupported AI job type: ${aiJob.type}`);
        }

        await throwIfCancelled();
        await job.updateProgress(80);

        await db.insert(aiOutputs).values({
          jobId: aiJob.id,
          outputType: aiJob.type,
          payload: output
        });

        await db
          .update(aiJobs)
          .set({
            status: 'succeeded',
            output,
            error: null,
            cancelRequested: false,
            updatedAt: new Date()
          })
          .where(eq(aiJobs.id, job.data.jobId));

        await job.updateProgress(100);
      } catch (error) {
        if (error instanceof CancelledError) {
          return;
        }

        const attemptNumber = job.attemptsMade + 1;
        const maxAttempts = job.opts.attempts ?? 1;
        const willRetry = attemptNumber < maxAttempts;
        const readerName = aiJob.type === 'parse_school_calendar' ? 'calendar' : 'schedule';
        const errorMessage =
          error instanceof z.ZodError
            ? `The ${readerName} reader could not recognize the imported dates. Please try again.`
            : error instanceof Error
              ? error.message
              : 'Unknown error';

        await db
          .update(aiJobs)
          .set({
            status: willRetry ? 'queued' : 'failed',
            error: willRetry
              ? `${errorMessage} (retry ${attemptNumber}/${maxAttempts})`
              : errorMessage,
            updatedAt: new Date()
          })
          .where(eq(aiJobs.id, job.data.jobId));

        await job.updateProgress(willRetry ? 5 : 100);
        throw error;
      }
    },
    {
      connection,
      concurrency: 3
    }
  );
}
