import fp from 'fastify-plugin';
import { verifyToken } from '@clerk/backend';

const defaultClerkJwtKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5eX3zK/SkRroDRqnGyTk
UZH7GaOJS3OIS1jXxwjZibV3IZoNTUsp6Nv3PdO4eS1gnCwmoj9K1huq32oUf844
jIrjsM2HPHclmnlSw/vRcNA/XrNJ0iNUVYzCUjWplo77IyotHSQzY1hcSB7BOSLz
AdtfhNOmDM5T0nu4Sx/UVxC8ngrvVbN81kzslP4R+JIZvDgkZpU0XRoAaYAXsUA7
UBWWJSk6XxQa5Ycv8W+8gGfdoYn9VFqQOSYYq3B3TQxi66qPBua+5t+9HWGmnoR7
Vaqef7Zss7xhqRE1N7Cz/GjNkWQq4tYY2IT+EwwkZ8s8DvBUcUQEHLRaUTFkzXjF
uwIDAQAB
-----END PUBLIC KEY-----`;

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

    const clerkJwtKey = app.config.CLERK_JWT_KEY || defaultClerkJwtKey;

    if (!app.config.CLERK_SECRET_KEY && !clerkJwtKey) {
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
        jwtKey: clerkJwtKey,
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
