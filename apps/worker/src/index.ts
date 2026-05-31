import 'dotenv/config';

import { z } from 'zod';

import { createAiJobsWorker } from '@teacheros/ai-worker';

const EnvSchema = z.object({
  REDIS_URL: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL_PARSE_SCHEDULE: z.string().default('gpt-4o-mini'),
  OPENAI_MODEL_GENERATE_SEGMENTS: z.string().default('gpt-4o'),
  OPENAI_MODEL_CONTINUITY: z.string().default('gpt-4o')
});

const env = EnvSchema.parse(process.env);

if (!env.REDIS_URL) {
  console.log('AI worker disabled: REDIS_URL is not configured');
  process.exit(0);
}

const worker = createAiJobsWorker({
  redisUrl: env.REDIS_URL,
  openAiApiKey: env.OPENAI_API_KEY,
  modelParseSchedule: env.OPENAI_MODEL_PARSE_SCHEDULE,
  modelGenerateSegments: env.OPENAI_MODEL_GENERATE_SEGMENTS,
  modelContinuity: env.OPENAI_MODEL_CONTINUITY
});

worker.on('ready', () => {
  console.log('AI worker ready');
});

worker.on('failed', (job, error) => {
  console.error(`Job ${job?.id ?? 'unknown'} failed`, error);
});

worker.on('completed', (job) => {
  console.log(`Job ${job.id ?? 'unknown'} completed`);
});

const shutdown = async (signal: string) => {
  console.log(`AI worker shutting down after ${signal}`);
  await worker.close();
  process.exit(0);
};

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
