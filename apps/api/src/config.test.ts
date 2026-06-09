import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('loadConfig', () => {
  it('treats blank optional provider values as unset', () => {
    process.env = {
      ...originalEnv,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/teacheros_test',
      CLERK_SECRET_KEY: '',
      CLERK_JWT_KEY: '',
      REDIS_URL: '',
      OPENAI_API_KEY: '',
      S3_ENDPOINT: '',
      S3_BUCKET: '',
      S3_ACCESS_KEY_ID: '',
      S3_SECRET_ACCESS_KEY: '',
      SENTRY_DSN: ''
    };

    expect(loadConfig()).toMatchObject({
      CLERK_SECRET_KEY: undefined,
      CLERK_JWT_KEY: undefined,
      REDIS_URL: undefined,
      OPENAI_API_KEY: undefined,
      S3_ENDPOINT: undefined,
      S3_BUCKET: undefined,
      S3_ACCESS_KEY_ID: undefined,
      S3_SECRET_ACCESS_KEY: undefined,
      SENTRY_DSN: undefined
    });
  });
});
