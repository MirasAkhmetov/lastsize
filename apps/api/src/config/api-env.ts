import { type ApiEnv, apiEnvSchema, loadEnv } from '@lastsize/config';

/** DI token for the validated API configuration. */
export const API_ENV = Symbol('API_ENV');

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  return loadEnv(apiEnvSchema, source);
}

export type { ApiEnv };
