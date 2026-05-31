import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { db } from '@teacheros/db';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health/liveness', async () => ({ ok: true }));

  app.get('/health/capabilities', async () => ({
    ok: true,
    database: true,
    redis: Boolean(app.redis),
    aiQueue: Boolean(app.aiQueue),
    aiWorker: Boolean(app.embeddedAiWorker),
    openai: Boolean(app.config.OPENAI_API_KEY),
    s3: Boolean(
      app.config.S3_BUCKET &&
        app.config.S3_ACCESS_KEY_ID &&
        app.config.S3_SECRET_ACCESS_KEY
    )
  }));

  app.get('/health/readiness', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      if (app.redis) {
        await app.redis.ping();
      }

      return { ok: true };
    } catch (error) {
      app.log.error({ error }, 'readiness check failed');
      reply.code(503);
      return { ok: false };
    }
  });
}
