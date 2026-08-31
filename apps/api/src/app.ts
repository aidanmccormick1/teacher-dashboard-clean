import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import * as Sentry from '@sentry/node';
import Fastify from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler
} from 'fastify-type-provider-zod';
import { createAiJobsWorker } from '@teacheros/ai-worker';

import type { AppConfig } from './config.js';
import { createRedisClient } from './lib/redis.js';
import { createAiQueue } from './lib/queue.js';
import { authPlugin } from './plugins/auth.js';
import { requestContextPlugin } from './plugins/request-context.js';
import { healthRoutes } from './routes/health.js';
import { testAuthRoutes } from './routes/test-auth.js';
import { v1Routes } from './routes/v1.js';

// Schedule screenshots and PDFs are read in the browser and sent as data URLs
// to the AI queue. A 10 MiB file grows to roughly 13.4 MiB when base64 encoded,
// so Fastify's default 1 MiB body limit rejects a valid upload before the route
// can create a job. Leave headroom for the JSON envelope while keeping an
// intentional ceiling on application request sizes.
const apiBodyLimitBytes = 16 * 1024 * 1024;

export async function createApp(config: AppConfig) {
  if (config.SENTRY_DSN) {
    Sentry.init({
      dsn: config.SENTRY_DSN,
      environment: config.NODE_ENV
    });
  }

  const app = Fastify({
    bodyLimit: apiBodyLimitBytes,
    logger: {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug'
    },
    genReqId: (request) => {
      const requestId = request.headers[config.REQUEST_ID_HEADER];
      return typeof requestId === 'string' && requestId.length > 0 ? requestId : randomUUID();
    }
  });

  app.decorate('config', config);

  const redis = createRedisClient(config.REDIS_URL);
  if (redis) {
    await redis.connect().catch((error: unknown) => {
      app.log.warn({ error }, 'Redis connection failed; continuing without cache');
    });
  }
  app.decorate('redis', redis);
  app.decorate('aiQueue', createAiQueue(redis));
  const embeddedAiWorker =
    config.RUN_EMBEDDED_AI_WORKER && config.REDIS_URL && config.OPENAI_API_KEY
      ? createAiJobsWorker({
          redisUrl: config.REDIS_URL,
          openAiApiKey: config.OPENAI_API_KEY,
          modelParseSchedule: config.OPENAI_MODEL_PARSE_SCHEDULE,
          reasoningEffortParseSchedule: config.OPENAI_REASONING_EFFORT_PARSE_SCHEDULE,
          modelGenerateSegments: config.OPENAI_MODEL_GENERATE_SEGMENTS,
          modelContinuity: config.OPENAI_MODEL_CONTINUITY
        })
      : null;
  app.decorate('embeddedAiWorker', embeddedAiWorker);

  if (config.RUN_EMBEDDED_AI_WORKER && !embeddedAiWorker) {
    app.log.warn('Embedded AI worker requested but REDIS_URL or OPENAI_API_KEY is not configured');
  }

  embeddedAiWorker?.on('ready', () => {
    app.log.info('Embedded AI worker ready');
  });

  embeddedAiWorker?.on('failed', (job, error) => {
    app.log.error({ jobId: job?.id, error }, 'Embedded AI job failed');
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, {
    origin: true,
    credentials: true,
    // Course and class-group editing uses PATCH and permanent deletion uses
    // DELETE. Include them in preflight responses so browser requests reach
    // the API instead of failing as a generic network error.
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS']
  });

  await app.register(helmet);

  await app.register(rateLimit, {
    // Database-backed integration runs issue many legitimate requests from one
    // injected client. Keep production protection intact without making test
    // outcomes depend on the order or size of unrelated test cases.
    max: config.NODE_ENV === 'test' ? 10_000 : 100,
    timeWindow: '1 minute'
  });

  if (config.ENABLE_API_DOCS) {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'TeacherOS API',
          version: '0.1.0'
        }
      },
      transform: jsonSchemaTransform
    });

    await app.register(swaggerUI, {
      routePrefix: '/docs'
    });
  }

  await app.register(requestContextPlugin);
  await app.register(testAuthRoutes);
  await app.register(authPlugin);
  await app.register(healthRoutes);

  await app.register(v1Routes);

  app.setErrorHandler((error, request, reply) => {
    app.log.error({ error, requestId: request.id }, 'request failed');
    Sentry.captureException(error, {
      tags: { requestId: request.id }
    });

    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof (error as { statusCode?: number }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    const message = error instanceof Error ? error.message : 'Internal server error';
    reply.code(statusCode).send({
      error: message,
      requestId: request.id
    });
  });

  app.addHook('onClose', async () => {
    if (embeddedAiWorker) {
      await embeddedAiWorker.close();
    }
    if (app.aiQueue) {
      await app.aiQueue.close();
    }
    if (redis) {
      await redis.quit();
    }
  });

  return app;
}
