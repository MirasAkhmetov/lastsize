import 'server-only';
import { adminServerEnvSchema, loadEnv } from '@lastsize/config';

export const serverEnv = loadEnv(adminServerEnvSchema);
