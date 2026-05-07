import { Redis } from 'ioredis';

export function createRedisClient(redisUrl?: string): Redis | null {
  if (!redisUrl) return null;

  return new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true
  });
}

export async function safeRedisGet(redis: Redis | null, key: string): Promise<string | null> {
  if (!redis) return null;
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

export async function safeRedisSet(
  redis: Redis | null,
  key: string,
  value: string,
  ttlSeconds: number
): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(key, value, 'EX', ttlSeconds);
  } catch {
    // best effort cache only
  }
}
