import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { API_ENV, type ApiEnv } from '../config/api-env';

export const PG_POOL = Symbol('PG_POOL');
export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) =>
        new Pool({
          connectionString: env.DATABASE_URL,
          max: 20,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
          application_name: 'lastsize-api',
        }),
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
  exports: [PG_POOL, REDIS],
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
