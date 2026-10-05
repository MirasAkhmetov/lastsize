import 'server-only';
import { loadEnv, webServerEnvSchema } from '@lastsize/config';

/** Validated server-side configuration. Importing this from a client component fails the build. */
export const serverEnv = loadEnv(webServerEnvSchema);
