import { z } from 'zod';

const nodeEnv = z.enum(['development', 'test', 'production']).default('development');
const logLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info');

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// URL' });
const redisUrl = z.url({ protocol: /^rediss?$/, error: 'must be a redis:// or rediss:// URL' });
const httpUrl = z.url({ protocol: /^https?$/, error: 'must be an http(s) URL' });

const port = z.coerce.number().int().min(1).max(65535);

const originList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  .pipe(z.array(httpUrl).min(1, 'must contain at least one origin'));

/** 32 random bytes, base64-encoded: `openssl rand -base64 32`. */
const encryptionKey = z.string().refine((value) => Buffer.from(value, 'base64').length === 32, {
  message: 'must be 32 bytes encoded as base64 (openssl rand -base64 32)',
});

export const apiEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  LOG_LEVEL: logLevel,
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: port.default(4000),
  CORS_ORIGINS: originList,
  DATABASE_URL: postgresUrl,
  REDIS_URL: redisUrl,
  /** Namespace for all Redis keys of this deployment (tests use a random one). */
  REDIS_KEY_PREFIX: z
    .string()
    .regex(/^[a-z0-9:_-]{1,32}$/)
    .default('ls:'),
  /** Encrypts secrets stored in the database (TOTP seeds, marketplace API tokens). */
  SECRETS_ENCRYPTION_KEY: encryptionKey,
});
export type ApiEnv = z.infer<typeof apiEnvSchema>;

/** Server-side only: read inside Next.js server components and route handlers. */
export const webServerEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  API_INTERNAL_URL: httpUrl,
  NEXT_PUBLIC_SITE_URL: httpUrl,
});
export type WebServerEnv = z.infer<typeof webServerEnvSchema>;

/** Admin panel, server side only. */
export const adminServerEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  API_INTERNAL_URL: httpUrl,
});
export type AdminServerEnv = z.infer<typeof adminServerEnvSchema>;
