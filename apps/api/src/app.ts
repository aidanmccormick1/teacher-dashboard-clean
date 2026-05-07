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

import type { AppConfig } from './config.js';
import { createRedisClient } from './lib/redis.js';
import { createAiQueue } from './lib/queue.js';
import { authPlugin } from './plugins/auth.js';
import { requestContextPlugin } from './plugins/request-context.js';
import { healthRoutes } from './routes/health.js';
import { v1Routes } from './routes/v1.js';

export async function createApp(config: AppConfig) {
  if (config.SENTRY_DSN) {
    Sentry.init({
      dsn: config.SENTRY_DSN,
      environment: config.NODE_ENV
    });
  }

  const app = Fastify({
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

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, {
    origin: true,
    credentials: true
  });

  await app.register(helmet);

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute'
  });

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

  await app.register(requestContextPlugin);
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
    if (redis) {
      await redis.quit();
    }
    if (app.aiQueue) {
      await app.aiQueue.close();
    }
  });

  return app;
}
