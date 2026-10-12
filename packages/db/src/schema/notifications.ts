import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id } from './columns.js';

export const notificationRecipient = pgEnum('notification_recipient', ['CUSTOMER', 'STORE']);
export const notificationChannel = pgEnum('notification_channel', ['TELEGRAM', 'WEB_PUSH']);
export const deliveryStatus = pgEnum('delivery_status', ['PENDING', 'SENT', 'FAILED']);
export const pushOwner = pgEnum('push_owner', ['USER', 'CUSTOMER']);

/**
 * In-app notifications. Texts are not stored: `type` and `params` are rendered in the reader's
 * language (ru / kk). A store's notifications are shared by all its members.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    recipientType: notificationRecipient('recipient_type').notNull(),
    /** customers.id or stores.id */
    recipientId: uuid('recipient_id').notNull(),
    /** e.g. "order.new", "order.readyForPickup" */
    type: text('type').notNull(),
    params: jsonb('params').$type<Record<string, string | number | null>>().notNull().default({}),
    /** Path inside the site, e.g. "/seller/orders/<id>". */
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_recipient_idx').on(t.recipientType, t.recipientId, t.createdAt),
    index('notifications_unread_idx')
      .on(t.recipientType, t.recipientId)
      .where(sql`${t.readAt} IS NULL`),
  ],
);

/**
 * Outbox of external deliveries (Telegram, Web Push), written in the same transaction as the
 * notification, so a crash between commit and sending never loses a message.
 */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: id(),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    channel: notificationChannel('channel').notNull(),
    /** Telegram chat id, or push_subscriptions.id. */
    target: text('target').notNull(),
    status: deliveryStatus('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('notification_deliveries_pending_idx')
      .on(t.createdAt)
      .where(sql`${t.status} = 'PENDING'`),
  ],
);

/** Browser push subscriptions (Web Push, VAPID). The endpoint is a capability URL: never shown. */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: id(),
    ownerType: pushOwner('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('push_subscriptions_endpoint_key').on(t.endpoint),
    index('push_subscriptions_owner_idx').on(t.ownerType, t.ownerId),
  ],
);
