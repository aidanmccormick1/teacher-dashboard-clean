import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.preprocess(
    (value) => value ?? process.env.PORT,
    z.coerce.number().int().positive().default(3001)
  ),
  REQUEST_ID_HEADER: z.string().default('x-request-id'),
  ENABLE_API_DOCS: z.coerce.boolean().default(false),
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_AUTHORIZED_PARTIES: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL_PARSE_SCHEDULE: z.string().default('gpt-4o-mini'),
  OPENAI_MODEL_GENERATE_SEGMENTS: z.string().default('gpt-4o'),
  OPENAI_MODEL_CONTINUITY: z.string().default('gpt-4o'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional()
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): AppConfig {
  return ConfigSchema.parse(process.env);
}
