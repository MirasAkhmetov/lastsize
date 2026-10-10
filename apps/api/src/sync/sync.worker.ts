import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Logger } from '@lastsize/logger';
import { type Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import { API_ENV, type ApiEnv } from '../config/api-env';
import { APP_LOGGER } from '../logging';
import { StockSyncService } from './stock-sync.service';
import {
  bullOptions,
  SYNC_QUEUE,
  SYNC_QUEUE_TOKEN,
  SyncScheduler,
  type SyncTrigger,
} from './sync-queue';

/** Scheduled sync of every connected marketplace. */
export const SWEEP_EVERY_MS = 10 * 60 * 1000;
const CONCURRENCY = 4;

/**
 * Runs stock syncs from the queue. Lives in its own process (dist/worker.js), so slow
 * marketplace APIs never hold up the website's API.
 */
@Injectable()
export class SyncWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private worker: Worker | null = null;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    @Inject(SYNC_QUEUE_TOKEN) private readonly queue: Queue,
    private readonly sync: StockSyncService,
    private readonly scheduler: SyncScheduler,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'sweep',
      { every: SWEEP_EVERY_MS },
      { name: 'sweep', data: {}, opts: { removeOnComplete: 10, removeOnFail: 50 } },
    );
    this.worker = new Worker(SYNC_QUEUE, (job) => this.process(job), {
      ...bullOptions(this.env),
      concurrency: CONCURRENCY,
    });
    this.worker.on('error', (error) => this.logger.warn({ err: error }, 'sync worker error'));
    this.worker.on('failed', (job, error) =>
      this.logger.warn({ err: error, jobId: job?.id, name: job?.name }, 'sync job failed'),
    );
    this.logger.info({ every: SWEEP_EVERY_MS }, 'sync worker started');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === 'sweep') {
      const ids = await this.sync.dueIntegrations();
      for (const id of ids) await this.scheduler.request(id, 'SCHEDULE');
      await this.sync.pruneRuns();
      return { queued: ids.length };
    }
    if (job.name !== 'sync') throw new UnrecoverableError(`unknown job ${job.name}`);
    const { integrationId, trigger } = job.data as { integrationId: string; trigger: SyncTrigger };
    // A busy integration (SyncBusyError) is retried by BullMQ with backoff; failures are logged
    // by the "failed" listener.
    return this.sync.run(integrationId, trigger);
  }
}
