import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';

import type { AppConfig } from './config.js';

export type RequestPrincipal = {
  clerkUserId: string;
  email: string | null;
};

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    redis: Redis | null;
    aiQueue: Queue<{ jobId: string }> | null;
  }

  interface FastifyRequest {
    principal: RequestPrincipal | null;
  }
}
