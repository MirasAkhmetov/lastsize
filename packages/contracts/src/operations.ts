import { z } from 'zod';
import {
  SELLER_ORDER_STATUSES,
  sellerOrderDetailSchema,
  sellerOrderListItemSchema,
} from './orders.js';
import { kzPhoneSchema } from './phone.js';

// ───────────────────────── admin: orders ─────────────────────────

export const adminOrderListQuerySchema = z.object({
  status: z.enum(SELLER_ORDER_STATUSES).optional(),
  /** Order number or part of the buyer's phone. */
  q: z
    .string()
    .trim()
    .regex(/^[\d +()-]{3,20}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const adminOrderListSchema = z.object({
  items: z.array(sellerOrderListItemSchema.extend({ storeId: z.uuid(), storeName: z.string() })),
  total: z.number().int(),
});
export type AdminOrderList = z.infer<typeof adminOrderListSchema>;

export const adminOrderDetailSchema = sellerOrderDetailSchema.extend({
  storeId: z.uuid(),
  storeName: z.string(),
  phoneBlocked: z.boolean(),
  /** Orders of this phone the stores could not complete because of the buyer (90 days). */
  phoneProblems: z.number().int(),
  canCancel: z.boolean(),
});
export type AdminOrderDetail = z.infer<typeof adminOrderDetailSchema>;

export const adminCancelRequestSchema = z.strictObject({
  note: z.string().trim().min(3, 'note.tooShort').max(300, 'note.tooLong'),
});

// ───────────────────────── admin: fake numbers ─────────────────────────

export const suspiciousPhoneSchema = z.object({
  phone: z.string(),
  orders: z.number().int(),
  unreachable: z.number().int(),
  notPickedUp: z.number().int(),
  refused: z.number().int(),
  lastOrderAt: z.iso.datetime({ offset: true }),
  blocked: z.boolean(),
});
export const suspiciousPhoneListSchema = z.array(suspiciousPhoneSchema);
export type SuspiciousPhone = z.infer<typeof suspiciousPhoneSchema>;

export const blockedPhoneSchema = z.object({
  phone: z.string(),
  reason: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
});
export const blockedPhoneListSchema = z.array(blockedPhoneSchema);
export type BlockedPhone = z.infer<typeof blockedPhoneSchema>;

export const blockPhoneRequestSchema = z.strictObject({
  phone: kzPhoneSchema,
  reason: z.string().trim().min(3, 'reason.tooShort').max(300, 'reason.tooLong'),
});

// ───────────────────────── admin: sync health ─────────────────────────

export const integrationHealthSchema = z.object({
  storeId: z.uuid(),
  storeName: z.string(),
  provider: z.enum(['WILDBERRIES', 'KASPI_XML']),
  status: z.enum(['ACTIVE', 'ERROR']),
  syncEnabled: z.boolean(),
  lastSyncAt: z.iso.datetime({ offset: true }).nullable(),
  lastError: z.string().nullable(),
  linkedCount: z.number().int(),
  failedRuns7d: z.number().int(),
  conflicts7d: z.number().int(),
});
export const integrationHealthListSchema = z.array(integrationHealthSchema);
export type IntegrationHealth = z.infer<typeof integrationHealthSchema>;

// ───────────────────────── analytics ─────────────────────────

export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

const rate = z.number().min(0).max(1);

export const platformAnalyticsSchema = z.object({
  days: z.number().int(),
  ordersPlaced: z.number().int(),
  sellerOrders: z.number().int(),
  completed: z.number().int(),
  cancelled: z.number().int(),
  cancelRate: rate,
  /** Share of seller orders cancelled because the goods were not there (stock quality). */
  outOfStockRate: rate,
  /** Completed goods value, minus accepted returns, in tiyn. */
  gmvCompleted: z.number().int(),
  returnsAccepted: z.number().int(),
  medianConfirmMinutes: z.number().nullable(),
  activeStores: z.number().int(),
  activeProducts: z.number().int(),
  /** North Star: completed seller orders per week, oldest first. */
  weekly: z.array(z.object({ weekStart: z.string(), completed: z.number().int() })),
  /** Stores with many cancellations recently (≥ 5 orders and > 10 % cancelled in 7 days). */
  storesToReview: z.array(
    z.object({
      storeId: z.uuid(),
      name: z.string(),
      orders: z.number().int(),
      cancelled: z.number().int(),
      cancelRate: rate,
    }),
  ),
});
export type PlatformAnalytics = z.infer<typeof platformAnalyticsSchema>;

export const storeAnalyticsSchema = z.object({
  days: z.number().int(),
  orders: z.number().int(),
  completed: z.number().int(),
  cancelled: z.number().int(),
  cancelRate: rate,
  /** Completed goods value minus accepted returns, in tiyn. */
  revenue: z.number().int(),
  returnsAccepted: z.number().int(),
  medianConfirmMinutes: z.number().nullable(),
  topProducts: z.array(
    z.object({ title: z.string(), units: z.number().int(), revenue: z.number().int() }),
  ),
});
export type StoreAnalytics = z.infer<typeof storeAnalyticsSchema>;
