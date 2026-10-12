import { z } from 'zod';

export const notificationSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  /** Path inside the site to open. */
  link: z.string().nullable(),
  read: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  unread: z.number().int(),
});
export type NotificationList = z.infer<typeof notificationListSchema>;

export const notificationListQuerySchema = z.object({
  lang: z.enum(['ru', 'kk']).default('ru'),
  /** Older than this notification (paging). */
  before: z.uuid().optional(),
});

export const markNotificationsReadRequestSchema = z
  .strictObject({
    ids: z.array(z.uuid()).max(100).optional(),
    all: z.literal(true).optional(),
  })
  .refine((body) => body.all || (body.ids?.length ?? 0) > 0, { message: 'notifications.none' });

/** Web Push subscription as the browser gives it (PushSubscription.toJSON()). */
export const pushSubscriptionRequestSchema = z.strictObject({
  endpoint: z.url({ protocol: /^https$/ }).max(1000),
  keys: z.strictObject({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/),
  }),
});
export const pushUnsubscribeRequestSchema = z.strictObject({
  endpoint: z.url({ protocol: /^https$/ }).max(1000),
});
export const pushConfigSchema = z.object({ publicKey: z.string().nullable() });

export const telegramLinkSchema = z.object({ url: z.string() });

export const passwordResetRequestSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{30,64}$/, 'reset.invalid'),
  password: z.string().min(10, 'password.tooShort').max(128, 'password.tooLong'),
});
