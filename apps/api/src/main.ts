import 'reflect-metadata';
import { createLogger } from '@lastsize/logger';
import { createApp } from './app.factory';
import { loadApiEnv } from './config/api-env';

async function bootstrap(): Promise<void> {
  const env = loadApiEnv();
  const logger = createLogger({
    service: 'api',
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV === 'development',
  });

  const app = await createApp(env, logger);
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  logger.info({ port: env.API_PORT }, 'api listening');
}

bootstrap().catch((error: unknown) => {
  // The logger may not exist yet (invalid env), so fall back to stderr.
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
