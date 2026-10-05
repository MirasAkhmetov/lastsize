import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestDatabase, type TestDatabase } from '@lastsize/db/testing';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { createApp } from '../src/app.factory';
import { loadApiEnv } from '../src/config/api-env';

export const integrationEnabled = Boolean(
  process.env.TEST_DATABASE_URL && process.env.TEST_REDIS_URL,
);
export const ALLOWED_ORIGIN = 'http://localhost:3000';

/** Silent by default; TEST_LOG=error (or debug) prints API logs while debugging a test. */
export const silentLogger = process.env.TEST_LOG
  ? pino({ level: process.env.TEST_LOG })
  : pino({ level: 'silent' }, new Writable({ write: (_chunk, _encoding, callback) => callback() }));

export interface Harness {
  app: NestFastifyApplication;
  database: TestDatabase;
  close: () => Promise<void>;
}

/** A full API on an isolated database and a private Redis key namespace. */
export async function startHarness(): Promise<Harness> {
  const database = await createTestDatabase();
  const redisKeyPrefix = `test:${randomBytes(4).toString('hex')}:`;
  const env = loadApiEnv({
    NODE_ENV: 'test',
    CORS_ORIGINS: ALLOWED_ORIGIN,
    DATABASE_URL: database.url,
    REDIS_URL: process.env.TEST_REDIS_URL,
    REDIS_KEY_PREFIX: redisKeyPrefix,
    SECRETS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  });
  const app = await createApp(env, silentLogger);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    app,
    database,
    close: async () => {
      await app.close();
      await database.drop();
      const redis = new Redis(process.env.TEST_REDIS_URL ?? '');
      const keys = await redis.keys(`${redisKeyPrefix}*`);
      if (keys.length > 0) await redis.del(...keys);
      await redis.quit();
    },
  };
}

let phoneCounter = 0;
/** A fresh valid Kazakhstan number per call. */
export function uniquePhone(): string {
  phoneCounter += 1;
  const tail =
    String(Date.now() % 1_000_000).padStart(6, '0') + String(phoneCounter).padStart(3, '0');
  return `+7700${tail.slice(-7)}`;
}

export function cookieHeader(response: { cookies: { name: string; value: string }[] }): string {
  return response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}
