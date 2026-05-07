import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { eq } from 'drizzle-orm';
import {
  GenerateContinuityResponseSchema,
  GenerateSegmentsResponseSchema,
  ParseScheduleResponseSchema
} from '@teacheros/contracts';

import { aiJobs, aiOutputs, db } from '@teacheros/db';
import { runStructuredPrompt } from '../lib/openai.js';

type AiQueuePayload = {
  jobId: string;
};

type WorkerConfig = {
  redisUrl: string;
  openAiApiKey: string;
  modelParseSchedule: string;
  modelGenerateSegments: string;
  modelContinuity: string;
};

class CancelledError extends Error {
  constructor() {
    super('Cancelled by user');
  }
}

export function createAiJobsWorker(config: WorkerConfig): Worker<AiQueuePayload> {
  const { redisUrl, openAiApiKey, modelParseSchedule, modelGenerateSegments, modelContinuity } =
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
          const input = aiJob.input as { text?: string; imageBase64?: string };
          output = await runStructuredPrompt({
            apiKey: openAiApiKey,
            model: modelParseSchedule,
            schemaName: 'parse_schedule',
            schema: ParseScheduleResponseSchema,
            systemPrompt:
              'Extract classes and assignments from teacher schedule text. Return JSON only and skip non-teaching events.',
            userPrompt: input.text
              ? `Parse this schedule and assignments:\n${input.text}`
              : 'Parse the supplied schedule image and return classes + assignments.'
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
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

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
