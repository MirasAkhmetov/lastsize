import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, createPool, type Database, type Pool } from '@lastsize/db';
import { Redis } from 'ioredis';
import { API_ENV, type ApiEnv } from '../config/api-env';

export const PG_POOL = Symbol('PG_POOL');
export const DATABASE = Symbol('DATABASE');
export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [API_ENV],
      useFactory: (env: ApiEnv): Pool =>
        createPool({ connectionString: env.DATABASE_URL, applicationName: 'lastsize-api' }),
    },
    {
      provide: DATABASE,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Database => createDatabase(pool),
    },
    {
      provide: REDIS,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) =>
        new Redis(env.REDIS_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: 2,
          connectionName: 'lastsize-api',
        }),
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
