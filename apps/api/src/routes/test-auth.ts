import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db, testAccounts } from '@teacheros/db';

const TestAuthRequestSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2, 'Username must be at least 2 characters.')
    .max(40, 'Username must be 40 characters or fewer.')
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Use letters, numbers, dots, dashes, or underscores.'),
  password: z.string().min(1, 'Password is required.').max(128, 'Password must be 128 characters or fewer.')
});

const TestAuthResponseSchema = z.object({
  token: z.string(),
  user: z.object({ username: z.string(), email: z.string() })
});

const InvalidAccountResponseSchema = z.object({
  error: z.string(),
  details: z.unknown().optional(),
  requestId: z.string()
});

const AuthErrorResponseSchema = z.object({
  error: z.string(),
  requestId: z.string()
});

function normalizeTestUsername(username: string): string {
  return username.trim().toLowerCase();
}

function hashPassword(password: string, salt = randomBytes(16).toString('hex')): string {
  const digest = createHash('sha256').update(`${salt}:${password}`).digest('hex');
  return `${salt}:${digest}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, digest] = storedHash.split(':');
  if (!salt || !digest) return false;

  const candidate = hashPassword(password, salt).split(':')[1];
  if (!candidate || candidate.length !== digest.length) return false;

  return timingSafeEqual(Buffer.from(candidate), Buffer.from(digest));
}

function createTestSessionToken(): string {
  return `test_${randomBytes(32).toString('base64url')}`;
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function testAuthRoutes(app: FastifyInstance) {
  app.post(
    '/v1/test-auth/signup',
    {
      schema: {
        tags: ['Test Auth'],
        body: TestAuthRequestSchema,
        response: {
          200: TestAuthResponseSchema,
          400: InvalidAccountResponseSchema,
          409: AuthErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const parsed = TestAuthRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({ error: 'Invalid account details', details: parsed.error.flatten(), requestId: request.id });
        return;
      }

      const username = normalizeTestUsername(parsed.data.username);
      const [existing] = await db
        .select({ id: testAccounts.id })
        .from(testAccounts)
        .where(eq(testAccounts.username, username))
        .limit(1);

      if (existing) {
        reply.code(409).send({ error: 'That username is already taken.', requestId: request.id });
        return;
      }

      const token = createTestSessionToken();
      const email = `${username}@test.teacheros.local`;
      const [account] = await db
        .insert(testAccounts)
        .values({
          username,
          email,
          passwordHash: hashPassword(parsed.data.password),
          sessionTokenHash: hashSessionToken(token)
        })
        .returning({ username: testAccounts.username, email: testAccounts.email });

      return { token, user: account };
    }
  );

  app.post(
    '/v1/test-auth/login',
    {
      schema: {
        tags: ['Test Auth'],
        body: TestAuthRequestSchema,
        response: {
          200: TestAuthResponseSchema,
          400: InvalidAccountResponseSchema,
          401: AuthErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const parsed = TestAuthRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({ error: 'Invalid account details', details: parsed.error.flatten(), requestId: request.id });
        return;
      }

      const username = normalizeTestUsername(parsed.data.username);
      const [account] = await db
        .select({
          id: testAccounts.id,
          username: testAccounts.username,
          email: testAccounts.email,
          passwordHash: testAccounts.passwordHash
        })
        .from(testAccounts)
        .where(eq(testAccounts.username, username))
        .limit(1);

      if (!account || !verifyPassword(parsed.data.password, account.passwordHash)) {
        reply.code(401).send({ error: 'Username or password is incorrect.', requestId: request.id });
        return;
      }

      const token = createTestSessionToken();
      await db
        .update(testAccounts)
        .set({ sessionTokenHash: hashSessionToken(token), updatedAt: new Date() })
        .where(eq(testAccounts.id, account.id));

      return { token, user: { username: account.username, email: account.email } };
    }
  );
}
