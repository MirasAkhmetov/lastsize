import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  and,
  asc,
  type Database,
  eq,
  lt,
  notificationDeliveries,
  notifications,
  pushSubscriptions,
  sql,
  users,
} from '@lastsize/db';
import type { Logger } from '@lastsize/logger';
import { type Job, Queue, Worker } from 'bullmq';
import { API_ENV, type ApiEnv } from '../config/api-env';
import { DATABASE } from '../infrastructure/infrastructure.module';
import { APP_LOGGER } from '../logging';
import { bullOptions } from '../sync/sync-queue';
import { type Lang, notificationText } from './notification-texts';
import { NOTIFICATIONS_QUEUE, NotificationsService } from './notifications.service';
import { PUSH_SENDER, type PushSender } from './push.sender';
import { TELEGRAM_API, type TelegramApi, TelegramError } from './telegram.client';

const BATCH = 100;
const MAX_ATTEMPTS = 5;
const SWEEP_EVERY_MS = 60_000;
const RETENTION = '90 days';

/**
 * Sends pending deliveries from the outbox: Telegram messages to sellers, browser push to
 * sellers and buyers. Woken right after a notification is created, and every minute anyway.
 */
@Injectable()
export class DeliveryWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TELEGRAM_API) private readonly telegram: TelegramApi,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
    private readonly notificationsService: NotificationsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.queue = new Queue(NOTIFICATIONS_QUEUE, bullOptions(this.env));
    await this.queue.upsertJobScheduler(
      'deliver-sweep',
      { every: SWEEP_EVERY_MS },
      { name: 'deliver', data: {}, opts: { removeOnComplete: 10, removeOnFail: 50 } },
    );
    this.worker = new Worker(NOTIFICATIONS_QUEUE, (job) => this.process(job), {
      ...bullOptions(this.env),
      concurrency: 1,
    });
    this.worker.on('error', (error) => this.logger.warn({ err: error }, 'delivery worker error'));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async process(_job?: Job): Promise<{ sent: number; failed: number }> {
    const pending = await this.db
      .select({
        id: notificationDeliveries.id,
        channel: notificationDeliveries.channel,
        target: notificationDeliveries.target,
        attempts: notificationDeliveries.attempts,
        type: notifications.type,
        params: notifications.params,
        link: notifications.link,
        recipientType: notifications.recipientType,
        recipientId: notifications.recipientId,
      })
      .from(notificationDeliveries)
      .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
      .where(eq(notificationDeliveries.status, 'PENDING'))
      .orderBy(asc(notificationDeliveries.createdAt))
      .limit(BATCH);
    let sent = 0;
    let failed = 0;
    for (const delivery of pending) {
      const lang: Lang =
        delivery.recipientType === 'CUSTOMER'
          ? await this.notificationsService.customerLang(delivery.recipientId)
          : 'ru';
      const text = notificationText(delivery.type, delivery.params, lang);
      const url = `${this.env.PUBLIC_SITE_URL}${lang === 'kk' && delivery.link ? '/kk' : ''}${delivery.link ?? ''}`;
      try {
        if (delivery.channel === 'TELEGRAM') {
          await this.telegram.sendMessage(Number(delivery.target), `${text.title}\n${text.body}`, {
            kind: 'link',
            label: 'Открыть',
            url,
          });
        } else {
          const [subscription] = await this.db
            .select()
            .from(pushSubscriptions)
            .where(eq(pushSubscriptions.id, delivery.target));
          const result = subscription
            ? await this.push.send(subscription, { ...text, url })
            : ('gone' as const);
          if (result === 'gone') {
            if (subscription)
              await this.db
                .delete(pushSubscriptions)
                .where(eq(pushSubscriptions.id, subscription.id));
            await this.finish(delivery.id, 'FAILED', 'push.gone');
            failed += 1;
            continue;
          }
        }
        await this.finish(delivery.id, 'SENT', null);
        sent += 1;
      } catch (error) {
        // The seller blocked the bot: stop sending there until they link it again.
        if (error instanceof TelegramError && error.code === 'tg.forbidden') {
          await this.db
            .update(users)
            .set({ telegramUserId: null })
            .where(eq(users.telegramUserId, BigInt(delivery.target)));
          await this.finish(delivery.id, 'FAILED', error.code);
          failed += 1;
          continue;
        }
        const code = error instanceof TelegramError ? error.code : 'push.failed';
        const attempts = delivery.attempts + 1;
        await this.db
          .update(notificationDeliveries)
          .set({
            attempts,
            lastError: code,
            status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
          })
          .where(eq(notificationDeliveries.id, delivery.id));
        if (attempts >= MAX_ATTEMPTS) failed += 1;
      }
    }
    await this.prune();
    return { sent, failed };
  }

  private async finish(id: string, status: 'SENT' | 'FAILED', error: string | null) {
    await this.db
      .update(notificationDeliveries)
      .set({ status, lastError: error, sentAt: status === 'SENT' ? sql`now()` : null })
      .where(eq(notificationDeliveries.id, id));
  }

  /** Read notifications older than 90 days are dropped. */
  private async prune(): Promise<void> {
    await this.db
      .delete(notifications)
      .where(
        and(
          sql`${notifications.readAt} IS NOT NULL`,
          lt(notifications.createdAt, sql`now() - ${sql.raw(`interval '${RETENTION}'`)}`),
        ),
      );
  }
}
