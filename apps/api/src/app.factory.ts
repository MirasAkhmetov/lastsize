import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Logger } from '@lastsize/logger';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import { PinoNestLogger } from './common/pino-nest-logger';
import type { ApiEnv } from './config/api-env';
import { createCsrfHook } from './security/csrf';

export const API_PREFIX = 'api/v1';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export async function createApp(env: ApiEnv, logger: Logger): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    loggerInstance: logger,
    // Behind Caddy on the private Docker network: trust X-Forwarded-* only from private addresses,
    // so the real client IP is used for rate limits and audit, and cannot be spoofed from outside.
    trustProxy: env.NODE_ENV === 'production' ? 'loopback,uniquelocal' : false,
    bodyLimit: 1024 * 1024,
    // Disabled so that an incoming x-request-id is always validated by genReqId below.
    requestIdHeader: false,
    genReqId: (request: IncomingMessage) => {
      const incoming = request.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
        ? incoming
        : randomUUID();
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(env, logger),
    adapter,
    {
      logger: new PinoNestLogger(logger),
      bufferLogs: false,
    },
  );

  await app.register(helmet, {
    // The API returns JSON only; the strictest policy is safe here.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cookie);
  app.getHttpAdapter().getInstance().addHook('onRequest', createCsrfHook(env.CORS_ORIGINS));
  app.enableCors({
    origin: [...env.CORS_ORIGINS],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'x-csrf-token', 'idempotency-key', 'x-request-id'],
    maxAge: 600,
  });
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (request, reply) => {
      reply.header('x-request-id', request.id);
    });

  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new ProblemDetailsFilter(logger));
  app.enableShutdownHooks();
  return app;
}
