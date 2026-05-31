import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { AppConfig } from './config.js';

let app: Awaited<ReturnType<typeof createApp>>;

beforeAll(async () => {
  const config: AppConfig = {
    NODE_ENV: 'test',
    API_PORT: 3001,
    REQUEST_ID_HEADER: 'x-request-id',
    ENABLE_API_DOCS: false,
    CLERK_AUTHORIZED_PARTIES: 'http://localhost:5173',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/teacheros_test',
    OPENAI_MODEL_CONTINUITY: 'gpt-4o',
    OPENAI_MODEL_GENERATE_SEGMENTS: 'gpt-4o',
    OPENAI_MODEL_PARSE_SCHEDULE: 'gpt-4o-mini',
    RUN_EMBEDDED_AI_WORKER: false,
    REDIS_URL: undefined,
    OPENAI_API_KEY: undefined,
    CLERK_SECRET_KEY: undefined,
    S3_REGION: 'us-east-1',
    S3_BUCKET: undefined,
    S3_ACCESS_KEY_ID: undefined,
    S3_SECRET_ACCESS_KEY: undefined,
    SENTRY_DSN: undefined
  };

  app = await createApp(config);
});

afterAll(async () => {
  await app.close();
});

describe('health endpoints', () => {
  it('returns liveness response', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health/liveness'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('reports non-sensitive runtime capabilities', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health/capabilities'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      database: true,
      redis: false,
      aiQueue: false,
      aiWorker: false,
      openai: false,
      s3: false
    });
  });
});

describe('authentication guard', () => {
  it('rejects protected routes without an authorization header', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/courses'
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: 'Missing Authorization header'
    });
  });

  it('fails closed when Clerk verification is not configured', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/courses',
      headers: {
        authorization: 'Bearer not-a-real-token'
      }
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: 'Clerk token verification is not configured'
    });
  });
});
