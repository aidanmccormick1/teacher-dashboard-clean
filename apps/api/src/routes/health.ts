import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { db } from '@teacheros/db';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health/liveness', async () => ({ ok: true }));

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
