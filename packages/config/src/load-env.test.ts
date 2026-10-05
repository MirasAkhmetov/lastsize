import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from './load-env.js';
import { apiEnvSchema } from './schemas.js';

const validApiEnv = {
  NODE_ENV: 'production',
  CORS_ORIGINS: 'https://lastsize.kz, https://www.lastsize.kz',
  DATABASE_URL: 'postgres://app:s3cret-value@db:5432/lastsize',
  REDIS_URL: 'redis://redis:6379',
};

describe('loadEnv', () => {
  it('parses and applies defaults', () => {
    const env = loadEnv(apiEnvSchema, validApiEnv);
    expect(env.API_PORT).toBe(4000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.CORS_ORIGINS).toEqual(['https://lastsize.kz', 'https://www.lastsize.kz']);
    expect(Object.isFrozen(env)).toBe(true);
  });

  it('reports every invalid variable at once', () => {
    try {
      loadEnv(apiEnvSchema, { API_PORT: '99999' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const variables = (error as EnvValidationError).issues.map((issue) => issue.variable);
      expect(variables).toEqual(
        expect.arrayContaining(['API_PORT', 'CORS_ORIGINS', 'DATABASE_URL', 'REDIS_URL']),
      );
    }
  });

  it('never includes secret values in the error message', () => {
    const secret = 'super-secret-password';
    expect(() =>
      loadEnv(apiEnvSchema, { ...validApiEnv, DATABASE_URL: `mysql://root:${secret}@db/x` }),
    ).toThrow(EnvValidationError);
    try {
      loadEnv(apiEnvSchema, { ...validApiEnv, DATABASE_URL: `mysql://root:${secret}@db/x` });
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });
});
