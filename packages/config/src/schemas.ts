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

export const apiEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  LOG_LEVEL: logLevel,
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: port.default(4000),
  CORS_ORIGINS: originList,
  DATABASE_URL: postgresUrl,
  REDIS_URL: redisUrl,
});
export type ApiEnv = z.infer<typeof apiEnvSchema>;

/** Server-side only: read inside Next.js server components and route handlers. */
export const webServerEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  API_INTERNAL_URL: httpUrl,
  NEXT_PUBLIC_SITE_URL: httpUrl,
});
export type WebServerEnv = z.infer<typeof webServerEnvSchema>;
