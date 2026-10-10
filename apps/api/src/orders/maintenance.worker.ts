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
import { bullOptions } from '../sync/sync-queue';
import { OrdersService } from './orders.service';

export const MAINTENANCE_QUEUE = 'maintenance';
const EXPIRE_EVERY_MS = 5 * 60 * 1000;

/** Periodic order housekeeping: cancels orders stores did not confirm in time. */
@Injectable()
export class MaintenanceWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly orders: OrdersService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.queue = new Queue(MAINTENANCE_QUEUE, bullOptions(this.env));
    await this.queue.upsertJobScheduler(
      'expire-orders',
      { every: EXPIRE_EVERY_MS },
      { name: 'expire-orders', data: {}, opts: { removeOnComplete: 10, removeOnFail: 50 } },
    );
    this.worker = new Worker(MAINTENANCE_QUEUE, (job) => this.process(job), {
      ...bullOptions(this.env),
      concurrency: 1,
    });
    this.worker.on('error', (error) =>
      this.logger.warn({ err: error }, 'maintenance worker error'),
    );
    this.worker.on('failed', (job, error) =>
      this.logger.warn({ err: error, name: job?.name }, 'maintenance job failed'),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== 'expire-orders') throw new UnrecoverableError(`unknown job ${job.name}`);
    const cancelled = await this.orders.expireUnconfirmed();
    if (cancelled) this.logger.info({ cancelled }, 'unconfirmed orders cancelled');
    return { cancelled };
  }
}
