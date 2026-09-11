import { z } from 'zod';

const booleanFromEnv = z.preprocess((value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean());

const optionalStringFromEnv = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional()
);

const optionalUrlFromEnv = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().url().optional()
);

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.preprocess(
    (value) => value ?? process.env.PORT,
    z.coerce.number().int().positive().default(3001)
  ),
  REQUEST_ID_HEADER: z.string().default('x-request-id'),
  ENABLE_API_DOCS: z.coerce.boolean().default(false),
  // Local-only auth shortcuts are opt-in. Test mode enables them for the
  // database-backed integration and auth unit suites.
  DEV_AUTH_ENABLED: booleanFromEnv.default(false),
  CLERK_SECRET_KEY: optionalStringFromEnv,
  CLERK_JWT_KEY: optionalStringFromEnv,
  CLERK_AUTHORIZED_PARTIES: z.string().default('http://localhost:5173'),
  ADMIN_CLAIM_REVIEW_TOKEN: optionalStringFromEnv,
  ADMIN_CLAIM_REVIEWER_EMAILS: z.string().default(''),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: optionalStringFromEnv,
  OPENAI_API_KEY: optionalStringFromEnv,
  OPENAI_MODEL_PARSE_SCHEDULE: z.string().default('gpt-5.6-sol'),
  OPENAI_REASONING_EFFORT_PARSE_SCHEDULE: z
    .enum(['low', 'medium', 'high', 'xhigh', 'max'])
    .default('xhigh'),
  OPENAI_MODEL_GENERATE_SEGMENTS: z.string().default('gpt-4o'),
  OPENAI_MODEL_CONTINUITY: z.string().default('gpt-4o'),
  RUN_EMBEDDED_AI_WORKER: booleanFromEnv.default(false),
  S3_REGION: z.string().default('auto'),
  S3_ENDPOINT: optionalUrlFromEnv,
  S3_FORCE_PATH_STYLE: booleanFromEnv.default(false),
  S3_BUCKET: optionalStringFromEnv,
  S3_ACCESS_KEY_ID: optionalStringFromEnv,
  S3_SECRET_ACCESS_KEY: optionalStringFromEnv,
  SENTRY_DSN: optionalStringFromEnv
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): AppConfig {
  const config = ConfigSchema.parse(process.env);
  if (config.NODE_ENV === 'production' && config.DEV_AUTH_ENABLED) {
    throw new Error('DEV_AUTH_ENABLED cannot be enabled in production.');
  }
  return config;
}
