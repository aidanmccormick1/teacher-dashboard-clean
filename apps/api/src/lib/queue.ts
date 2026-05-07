import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const AI_JOB_MAX_ATTEMPTS = 3;

export function createAiQueue(redis: Redis | null): Queue<{ jobId: string }> | null {
  if (!redis) return null;
  return new Queue<{ jobId: string }>('ai-jobs', {
    connection: redis,
    defaultJobOptions: {
      attempts: AI_JOB_MAX_ATTEMPTS,
      backoff: {
        type: 'exponential',
        delay: 1000
      },
      removeOnComplete: 1000,
      removeOnFail: 1000
    }
  });
}

export async function enqueueAiJob(
  queue: Queue<{ jobId: string }> | null,
  jobId: string
): Promise<boolean> {
  if (!queue) return false;
  await queue.add('process-ai-job', { jobId }, { jobId });
  return true;
}
