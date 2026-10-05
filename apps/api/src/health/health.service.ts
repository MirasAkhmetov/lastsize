import { Inject, Injectable } from '@nestjs/common';
import type { ReadinessResponse } from '@lastsize/contracts';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { PG_POOL, REDIS } from '../infrastructure/infrastructure.module';

const CHECK_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('health check timed out')), CHECK_TIMEOUT_MS).unref();
    }),
  ]);
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async readiness(): Promise<ReadinessResponse> {
    const [database, redis] = await Promise.all([
      withTimeout(this.pool.query('SELECT 1')).then(
        () => 'up' as const,
        () => 'down' as const,
      ),
      withTimeout(this.pingRedis()).then(
        () => 'up' as const,
        () => 'down' as const,
      ),
    ]);
    const ready = database === 'up' && redis === 'up';
    return { status: ready ? 'ready' : 'not_ready', checks: { database, redis } };
  }

  private async pingRedis(): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
    await this.redis.ping();
  }
}
