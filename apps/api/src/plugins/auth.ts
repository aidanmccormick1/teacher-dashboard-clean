import fp from 'fastify-plugin';
import { verifyToken } from '@clerk/backend';

export const authPlugin = fp(async (app) => {
  app.decorateRequest('principal', null);

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '/';
    if (path.startsWith('/health') || path.startsWith('/docs')) return;

    const authHeader = request.headers.authorization;
    const devUser = request.headers['x-dev-user-id'];
    const devEmail = request.headers['x-dev-user-email'];

    if (!authHeader) {
      if (app.config.NODE_ENV !== 'production' && typeof devUser === 'string' && devUser.length > 0) {
        request.principal = {
          clerkUserId: devUser,
          email: typeof devEmail === 'string' ? devEmail : null
        };
        return;
      }

      reply.code(401).send({ error: 'Missing Authorization header', requestId: request.id });
      return;
    }

    if (!app.config.CLERK_SECRET_KEY && !app.config.CLERK_JWT_KEY) {
      reply.code(500).send({ error: 'Clerk token verification is not configured', requestId: request.id });
      return;
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      reply.code(401).send({ error: 'Invalid Authorization header', requestId: request.id });
      return;
    }

    try {
      const tokenClaims = await verifyToken(token, {
        secretKey: app.config.CLERK_SECRET_KEY,
        jwtKey: app.config.CLERK_JWT_KEY,
        authorizedParties: app.config.CLERK_AUTHORIZED_PARTIES.split(',').map((value) => value.trim())
      });

      request.principal = {
        clerkUserId: tokenClaims.sub,
        email: typeof tokenClaims.email === 'string' ? tokenClaims.email : null
      };
    } catch {
      reply.code(401).send({ error: 'Invalid authentication token', requestId: request.id });
    }
  });
});
