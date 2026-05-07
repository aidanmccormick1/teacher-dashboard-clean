import 'dotenv/config';

import { createApp } from './app.js';
import { loadConfig } from './config.js';

async function bootstrap() {
  const config = loadConfig();
  const app = await createApp(config);

  await app.listen({
    host: '0.0.0.0',
    port: config.API_PORT
  });

  app.log.info(`API listening on ${config.API_PORT}`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
