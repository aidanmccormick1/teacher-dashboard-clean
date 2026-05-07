import fp from 'fastify-plugin';

export const requestContextPlugin = fp(async (app) => {
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header(app.config.REQUEST_ID_HEADER, request.id);
    return payload;
  });
});
