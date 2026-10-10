import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { and, type Database, eq, integrations, sql } from '@lastsize/db';
import type { Logger } from '@lastsize/logger';
import { Queue } from 'bullmq';
import { API_ENV, type ApiEnv } from '../config/api-env';
import { DATABASE } from '../infrastructure/infrastructure.module';
import { APP_LOGGER } from '../logging';

export const SYNC_QUEUE = 'stock-sync';
export const SYNC_QUEUE_TOKEN = Symbol('SYNC_QUEUE');

export type SyncTrigger = 'SCHEDULE' | 'MANUAL' | 'STOCK_CHANGE';
export type SyncJob =
  | { name: 'sync'; data: { integrationId: string; trigger: SyncTrigger } }
  | { name: 'sweep'; data: Record<string, never> };

/** BullMQ keeps its keys under the deployment's Redis prefix, so tests and stages never mix. */
export function bullOptions(env: ApiEnv) {
  return {
    connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
    prefix: `${env.REDIS_KEY_PREFIX}bull`,
  };
}

/** How long to wait after a stock change, so a burst of edits becomes one sync. */
const STOCK_CHANGE_DELAY_MS = 5_000;

/** Puts stock syncs on the queue; the worker process runs them. */
@Injectable()
export class SyncScheduler {
  constructor(
    @Inject(SYNC_QUEUE_TOKEN) private readonly queue: Queue,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * One sync per integration at a time: while one runs, later requests collapse into a single
   * follow-up run (BullMQ deduplication with keepLastIfActive).
   */
  async request(integrationId: string, trigger: SyncTrigger, delay = 0): Promise<void> {
    await this.queue.add(
      'sync',
      { integrationId, trigger },
      {
        delay,
        deduplication: { id: `sync:${integrationId}`, keepLastIfActive: true },
        attempts: 5,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
  }

  /**
   * Our stock changed (seller edit, order): push it to marketplaces that accept writes.
   * Never fails the caller; the periodic sweep catches anything missed.
   */
  async storeStockChanged(storeId: string): Promise<void> {
    try {
      const rows = await this.db
        .select({ id: integrations.id })
        .from(integrations)
        .where(
          and(
            eq(integrations.storeId, storeId),
            eq(integrations.provider, 'WILDBERRIES'),
            sql`coalesce((${integrations.settings}->>'syncEnabled')::boolean, true)`,
            sql`coalesce((${integrations.settings}->>'pushStock')::boolean, false)`,
          ),
        );
      for (const row of rows) await this.request(row.id, 'STOCK_CHANGE', STOCK_CHANGE_DELAY_MS);
    } catch (error) {
      this.logger.warn({ err: error, storeId }, 'could not queue stock sync');
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: SYNC_QUEUE_TOKEN,
      inject: [API_ENV, APP_LOGGER],
      useFactory: (env: ApiEnv, logger: Logger) => {
        const queue = new Queue(SYNC_QUEUE, bullOptions(env));
        queue.on('error', (error) => logger.warn({ err: error }, 'sync queue error'));
        return queue;
      },
    },
    SyncScheduler,
  ],
  exports: [SyncScheduler, SYNC_QUEUE_TOKEN],
})
export class SyncQueueModule implements OnApplicationShutdown {
  constructor(@Inject(SYNC_QUEUE_TOKEN) private readonly queue: Queue) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
