import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  GenerateContinuityResponseSchema,
  GenerateSegmentsResponseSchema,
  ParseScheduleResponseSchema
} from '@teacheros/contracts';
import { aiJobs, aiOutputs, db } from '@teacheros/db';

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
  'COURSE AND CLASS-GROUP RULE (required): A subject plus its number is the COURSE name, not a class group. This includes Spanish 5, Spanish 6, Spanish 7, Spanish 8, Math 5, Math 6, and similarly numbered subjects.',
  'The `name` field must contain that complete course name, including the number. Put only the subgroup/section in `period`.',
  'For example: Spanish 5A => `name: "Spanish 5"`, `period: "Group A"`; Spanish 5B => `name: "Spanish 5"`, `period: "Group B"`; Math 6, when no subgroup is shown => `name: "Math 6"`, `period: "Main section"`.',
  'Never return `name: "Spanish"` with `period: "5"`, and never make Spanish 5, Spanish 6, Spanish 7, or Spanish 8 into groups below one Spanish course. They are separate courses. The same rule applies to every numbered subject.',
  'A/B/C suffixes and words such as Block, Period, Section, or Group identify a class group only after the complete course name has been removed. A bell-period/grid row is never a class-group label.'
].join('\n');

function scheduleImportUserPrompt(input: ScheduleImportInput): string {
  if (input.text) {
    return [
      'Parse this teacher schedule and assignments.',
      scheduleCourseGroupingInstructions,
      'For example, Spanish 5A, Spanish 5B, and Spanish 5C are one course named Spanish 5; Pre-Calculus Block 1, Block 3, and Block 4 are one course named Pre-Calculus.',
      'A schedule may show the same class group on more than one day at different times. Emit one class object per meeting occurrence, but repeat the exact same course name and class-group label for each occurrence.',
      'The `period` field is the class-group label, not a bell-period/grid row. Spanish 5B on Monday at 08:10 and Thursday at 13:35 must both use `name: "Spanish 5"` and `period: "Group B"`; only the day and time change. Return every time as 24-hour `HH:MM` (for example, `08:10`) or null when it is not visible.',
      'For a visual grid, audit every nonempty teaching cell across every weekday column. A shorthand such as 7B means Spanish 7, Group B; text in parentheses is the room/location. Do not omit a group just because another group from that grade appears elsewhere.',
      'Keep every class group and all of its meeting times. Return JSON only.',
      '',
      input.text
    ].join('\n');
  }
  if (input.fileMimeType === 'application/pdf' || input.fileName?.toLowerCase().endsWith('.pdf')) {
    return `Parse the uploaded PDF schedule. Extract teaching classes and assignments.\n${scheduleCourseGroupingInstructions}\nReturn JSON only.`;
  }
  return `Parse the uploaded schedule image. Extract teaching classes and assignments.\n${scheduleCourseGroupingInstructions}\nReturn JSON only.`;
}

export function createAiJobsWorker(config: AiWorkerConfig): Worker<AiQueuePayload> {
  const { redisUrl, openAiApiKey, modelParseSchedule, reasoningEffortParseSchedule, modelGenerateSegments, modelContinuity } =
    config;
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null
  });

  return new Worker<AiQueuePayload>(
    'ai-jobs',
    async (job) => {
      const [aiJob] = await db
        .select({
          id: aiJobs.id,
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
          output = await runStructuredPrompt({
            apiKey: openAiApiKey,
            model: modelParseSchedule,
            reasoningEffort: reasoningEffortParseSchedule,
            schemaName: 'parse_schedule',
            schema: ParseScheduleResponseSchema,
            systemPrompt:
              `Extract classes and assignments from teacher schedules. Return JSON only and skip non-teaching events. Each record is one meeting occurrence: \`name\` is the shared curriculum and \`period\` is the class-group label, never the bell-period/grid row. ${scheduleCourseGroupingInstructions} Repeat a class group label for every one of its distinct meeting times so the app can merge them. For grid images, audit every nonempty teaching cell across every weekday column before returning and translate shorthand such as 7B into Spanish 7, Group B. Return \`time\` and \`endTime\` as 24-hour \`HH:MM\` strings (for example, \`08:10\`) or null when a time is not visible.`,
            userPrompt: scheduleImportUserPrompt(input),
            fileDataUrl: scheduleImportFileDataUrl(input),
            fileName: input.fileName
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
              'Generate practical, classroom-ready lesson segments with realistic durations and concise descriptions.',
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
              'You are helping a teacher continue the next class smoothly. Keep output concise and practical.',
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
        const errorMessage =
          error instanceof z.ZodError
            ? 'The schedule reader could not recognize one or more meeting times. Please try again.'
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
