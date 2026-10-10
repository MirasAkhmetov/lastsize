import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createLogger } from '@lastsize/logger';
import { PinoNestLogger } from './common/pino-nest-logger';
import { loadApiEnv } from './config/api-env';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const env = loadApiEnv();
  const logger = createLogger({
    service: 'worker',
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV === 'development',
  });
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env, logger), {
    logger: new PinoNestLogger(logger),
  });
  app.enableShutdownHooks();
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
