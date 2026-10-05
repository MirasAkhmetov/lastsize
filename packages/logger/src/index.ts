import { pino, type Logger, type LoggerOptions } from 'pino';

/**
 * Paths whose values must never reach logs. Matching is case-sensitive, so common spellings
 * are listed explicitly. `*` matches one level of nesting.
 */
export const REDACTED_PATHS: readonly string[] = [
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'api_key',
  'secret',
  'clientSecret',
  'credentials',
  'otp',
  '*.password',
  '*.passwordHash',
  '*.password_hash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
  '*.api_key',
  '*.secret',
  '*.clientSecret',
  '*.credentials',
  '*.otp',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-auth-token"]',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
];

export interface CreateLoggerOptions {
  /** Service name: api, worker, web. Added to every line as `service`. */
  service: string;
  level?: LoggerOptions['level'];
  /** Pretty, human-readable output for local development only. */
  pretty?: boolean;
}

export function createLogger({
  service,
  level = 'info',
  pretty = false,
}: CreateLoggerOptions): Logger {
  return pino({
    level,
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: [...REDACTED_PATHS], censor: '[REDACTED]' },
    formatters: {
      level: (label) => ({ level: label }),
    },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  });
}

export type { Logger } from 'pino';
