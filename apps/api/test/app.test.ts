import 'reflect-metadata';
import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { problemDetailsSchema, readinessResponseSchema } from '@lastsize/contracts';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.factory';
import { loadApiEnv } from '../src/config/api-env';

const silentLogger = pino(
  { level: 'silent' },
  new Writable({ write: (_chunk, _encoding, callback) => callback() }),
);

async function startApp(overrides: Record<string, string>): Promise<NestFastifyApplication> {
  const env = loadApiEnv({
    NODE_ENV: 'test',
    CORS_ORIGINS: 'http://localhost:3000',
    DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none',
    REDIS_URL: 'redis://127.0.0.1:1',
    SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    ...overrides,
  });
  const app = await createApp(env, silentLogger);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('API without reachable dependencies', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    app = await startApp({});
  });
  afterAll(async () => {
    await app.close();
  });

  it('answers liveness without touching dependencies', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('reports not ready with 503 when Postgres and Redis are down', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(readinessResponseSchema.parse(response.json())).toEqual({
      status: 'not_ready',
      checks: { database: 'down', redis: 'down' },
    });
  });

  it('returns RFC 9457 problem details for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist?x=1' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    const problem = problemDetailsSchema.parse(response.json());
    expect(problem.code).toBe('NOT_FOUND');
    expect(problem.instance).toBe('/api/v1/does-not-exist');
  });

  it('echoes a valid request id and replaces an invalid one', async () => {
    const valid = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'x-request-id': 'abc12345-test' },
    });
    expect(valid.headers['x-request-id']).toBe('abc12345-test');

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'x-request-id': '<script>' },
    });
    expect(invalid.headers['x-request-id']).not.toBe('<script>');
  });

  it('sends security headers', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS only for configured origins', async () => {
    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/health',
      headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'GET' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');

    const denied = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/health',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});

// Runs against real Postgres and Redis: locally after `pnpm infra:up`, and in CI.
describe.runIf(process.env.TEST_DATABASE_URL && process.env.TEST_REDIS_URL)(
  'API with Postgres and Redis',
  () => {
    let app: NestFastifyApplication;
    beforeAll(async () => {
      app = await startApp({
        DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
        REDIS_URL: process.env.TEST_REDIS_URL ?? '',
      });
    });
    afterAll(async () => {
      await app.close();
    });

    it('reports ready', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ready', checks: { database: 'up', redis: 'up' } });
    });
  },
);
