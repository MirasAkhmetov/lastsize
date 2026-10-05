import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, createPool, type Database, type Pool } from '@lastsize/db';
import { Redis } from 'ioredis';
import type { Logger } from '@lastsize/logger';
import { API_ENV, type ApiEnv } from '../config/api-env';
import { APP_LOGGER } from '../logging';

export const PG_POOL = Symbol('PG_POOL');
export const DATABASE = Symbol('DATABASE');
export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [API_ENV, APP_LOGGER],
      useFactory: (env: ApiEnv, logger: Logger): Pool =>
        createPool({
          connectionString: env.DATABASE_URL,
          applicationName: 'lastsize-api',
          onIdleError: (error) => logger.warn({ err: error }, 'postgres idle client error'),
        }),
    },
    {
      provide: DATABASE,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Database => createDatabase(pool),
    },
    {
      provide: REDIS,
      inject: [API_ENV, APP_LOGGER],
      useFactory: (env: ApiEnv, logger: Logger) => {
        const redis = new Redis(env.REDIS_URL, {
          lazyConnect: true,
          keyPrefix: env.REDIS_KEY_PREFIX,
          maxRetriesPerRequest: 2,
          connectionName: 'lastsize-api',
        });
        // ioredis reconnects on its own; the listener keeps errors in structured logs.
        redis.on('error', (error) => logger.warn({ err: error }, 'redis connection error'));
        return redis;
      },
    },
  ],
  exports: [PG_POOL, DATABASE, REDIS],
})
export class InfrastructureModule implements OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.pool.end(), this.redis.quit()]);
  }
}
