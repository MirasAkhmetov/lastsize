import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import {
  and,
  count,
  customers,
  type Database,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  notificationDeliveries,
  notifications,
  pushSubscriptions,
  sql,
  storeMembers,
  type Transaction,
  users,
} from '@lastsize/db';
import type { Logger } from '@lastsize/logger';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { API_ENV, type ApiEnv } from '../config/api-env';
import { DATABASE, REDIS } from '../infrastructure/infrastructure.module';
import { APP_LOGGER } from '../logging';
import { bullOptions } from '../sync/sync-queue';
import { type Lang, notificationText } from './notification-texts';

export type Recipient = { type: 'CUSTOMER' | 'STORE'; id: string };
type Params = Record<string, string | number | null>;

export const NOTIFICATIONS_QUEUE = 'notifications';
const CHANNEL = 'notify';
const PAGE = 30;

export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

/**
 * Notifications for buyers and stores. `create` runs inside the caller's transaction, together
 * with an outbox row per external channel (Telegram, browser push), so nothing is sent for a
 * change that rolled back and nothing is lost if the process dies after the commit.
 * `published` then wakes open pages (SSE) and the delivery worker.
 */
@Injectable()
export class NotificationsService implements OnApplicationShutdown {
  private readonly queue: Queue;
  private readonly channel: string;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(API_ENV) env: ApiEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {
    this.queue = new Queue(NOTIFICATIONS_QUEUE, bullOptions(env));
    this.queue.on('error', (error) => logger.warn({ err: error }, 'notifications queue error'));
    this.channel = `${env.REDIS_KEY_PREFIX}${CHANNEL}`;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }

  get pubsubChannel(): string {
    return this.channel;
  }

  async create(
    tx: Transaction,
    recipient: Recipient,
    type: string,
    params: Params,
    link: string | null,
  ): Promise<{ id: string; recipient: Recipient }> {
    const [row] = await tx
      .insert(notifications)
      .values({ recipientType: recipient.type, recipientId: recipient.id, type, params, link })
      .returning({ id: notifications.id });
    const id = row!.id;

    const deliveries: { channel: 'TELEGRAM' | 'WEB_PUSH'; target: string }[] = [];
    if (recipient.type === 'STORE') {
      // Every member of the store who linked Telegram or allowed browser notifications.
      const members = await tx
        .select({ userId: users.id, telegram: users.telegramUserId })
        .from(storeMembers)
        .innerJoin(users, eq(users.id, storeMembers.userId))
        .where(and(eq(storeMembers.storeId, recipient.id), eq(users.status, 'ACTIVE')));
      for (const member of members)
        if (member.telegram !== null)
          deliveries.push({ channel: 'TELEGRAM', target: String(member.telegram) });
      const userIds = members.map((member) => member.userId);
      if (userIds.length) {
        const subscriptions = await tx
          .select({ id: pushSubscriptions.id })
          .from(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.ownerType, 'USER'),
              inArray(pushSubscriptions.ownerId, userIds),
            ),
          );
        for (const s of subscriptions) deliveries.push({ channel: 'WEB_PUSH', target: s.id });
      }
    } else {
      const subscriptions = await tx
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.ownerType, 'CUSTOMER'),
            eq(pushSubscriptions.ownerId, recipient.id),
          ),
        );
      for (const s of subscriptions) deliveries.push({ channel: 'WEB_PUSH', target: s.id });
    }
    if (deliveries.length)
      await tx
        .insert(notificationDeliveries)
        .values(deliveries.map((delivery) => ({ notificationId: id, ...delivery })));
    return { id, recipient };
  }

  /** After the commit: wake open pages and the delivery worker. Never throws. */
  async published(created: { id: string; recipient: Recipient }[]): Promise<void> {
    if (created.length === 0) return;
    try {
      for (const { id, recipient } of created) {
        await this.redis.publish(
          this.channel,
          JSON.stringify({ id, type: recipient.type, recipientId: recipient.id }),
        );
      }
      await this.queue.add(
        'deliver',
        {},
        {
          deduplication: { id: 'deliver', keepLastIfActive: true },
          removeOnComplete: 50,
          removeOnFail: 100,
        },
      );
    } catch (error) {
      // The worker's periodic sweep still sends pending deliveries.
      this.logger.warn({ err: error }, 'could not publish notifications');
    }
  }

  async list(recipient: Recipient, lang: Lang, before?: string): Promise<NotificationView[]> {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientType, recipient.type),
          eq(notifications.recipientId, recipient.id),
          before ? lt(notifications.id, before) : undefined,
        ),
      )
      .orderBy(desc(notifications.id))
      .limit(PAGE);
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      ...notificationText(row.type, row.params, lang),
      link: row.link,
      read: row.readAt !== null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async unread(recipient: Recipient): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientType, recipient.type),
          eq(notifications.recipientId, recipient.id),
          isNull(notifications.readAt),
        ),
      );
    return row?.total ?? 0;
  }

  /** Marks the given notifications (or all) of this recipient as read. */
  async markRead(recipient: Recipient, ids: string[] | 'all'): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(
        and(
          eq(notifications.recipientType, recipient.type),
          eq(notifications.recipientId, recipient.id),
          isNull(notifications.readAt),
          ids === 'all'
            ? undefined
            : inArray(
                notifications.id,
                ids.length ? ids : ['00000000-0000-0000-0000-000000000000'],
              ),
        ),
      );
  }

  /** The language a buyer used last; stores get Russian unless they choose otherwise later. */
  async customerLang(customerId: string): Promise<Lang> {
    const [row] = await this.db
      .select({ locale: customers.locale })
      .from(customers)
      .where(eq(customers.id, customerId));
    return row?.locale === 'kk' ? 'kk' : 'ru';
  }
}
