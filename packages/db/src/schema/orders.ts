import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { productVariants } from './catalog.js';
import { createdAt, id, updatedAt } from './columns.js';
import { customers } from './identity.js';
import { auditActorType } from './security.js';
import { stores } from './stores.js';

export const sellerOrderStatus = pgEnum('seller_order_status', [
  'NEW',
  'CONFIRMED',
  'READY_FOR_PICKUP',
  'COURIER_REQUESTED',
  'HANDED_TO_COURIER',
  'COMPLETED',
  'CANCELLED',
]);
export const fulfillmentType = pgEnum('fulfillment_type', ['PICKUP', 'DELIVERY']);
export const paymentStatus = pgEnum('payment_status', ['UNPAID', 'PAID_TO_SELLER']);

/** Order numbers people say on the phone: short, sequential, not guessable as access keys. */
export const orderNumberSeq = pgSequence('order_number_seq', { startWith: 10001 });

/** The guest's cart, one row per size. The price is only for showing "the price changed". */
export const cartItems = pgTable(
  'cart_items',
  {
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    priceSnapshot: bigint('price_snapshot', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.customerId, t.variantId] }),
    check('cart_items_quantity_range', sql`${t.quantity} BETWEEN 1 AND 10`),
  ],
);

export interface LocationSnapshot {
  storeName: string;
  storeSlug: string;
  address: string;
  cityId: number;
  phone: string;
}

/** One checkout. Contacts are a snapshot; the guest can change their profile later. */
export const orders = pgTable(
  'orders',
  {
    id: id(),
    number: bigint('number', { mode: 'number' })
      .notNull()
      .default(sql`nextval('order_number_seq')`),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    contactName: text('contact_name').notNull(),
    contactPhone: text('contact_phone').notNull(),
    /** SHA-256 of the random token in the order link that opens it on any device. */
    accessTokenHash: text('access_token_hash').notNull(),
    /** Client-generated key: a repeated submit returns the same order instead of a new one. */
    idempotencyKey: text('idempotency_key').notNull(),
    itemsTotal: bigint('items_total', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('orders_number_key').on(t.number),
    uniqueIndex('orders_customer_idempotency_key').on(t.customerId, t.idempotencyKey),
    index('orders_customer_idx').on(t.customerId, t.createdAt),
    index('orders_phone_idx').on(t.contactPhone),
  ],
);

/** The part of an order one store fulfils, with its own status. */
export const sellerOrders = pgTable(
  'seller_orders',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    status: sellerOrderStatus('status').notNull().default('NEW'),
    fulfillment: fulfillmentType('fulfillment').notNull(),
    paymentStatus: paymentStatus('payment_status').notNull().default('UNPAID'),
    /** Where to pick up (store address at the time of the order). */
    locationSnapshot: jsonb('location_snapshot').$type<LocationSnapshot>().notNull(),
    deliveryAddress: text('delivery_address'),
    deliveryComment: text('delivery_comment'),
    /** Actual courier price entered by the store; paid by the buyer. */
    courierFee: bigint('courier_fee', { mode: 'number' }),
    itemsTotal: bigint('items_total', { mode: 'number' }).notNull(),
    platformFee: bigint('platform_fee', { mode: 'number' }).notNull().default(0),
    /** Code, e.g. "customer.changedMind" or "system.notConfirmed". */
    cancelReason: text('cancel_reason'),
    /** A NEW order not confirmed by then is cancelled and its stock released. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('seller_orders_order_store_key').on(t.orderId, t.storeId),
    index('seller_orders_store_idx').on(t.storeId, t.status, t.createdAt),
    index('seller_orders_expiry_idx')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'NEW'`),
    check(
      'seller_orders_delivery_address',
      sql`${t.fulfillment} = 'PICKUP' OR ${t.deliveryAddress} IS NOT NULL`,
    ),
  ],
);

/** What was bought, frozen at checkout. Rows can never change (database trigger). */
export const orderItems = pgTable(
  'order_items',
  {
    id: id(),
    sellerOrderId: uuid('seller_order_id')
      .notNull()
      .references(() => sellerOrders.id, { onDelete: 'restrict' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    productShortId: text('product_short_id').notNull(),
    productSlug: text('product_slug').notNull(),
    title: text('title').notNull(),
    brand: text('brand'),
    sku: text('sku').notNull(),
    size: text('size'),
    colorId: integer('color_id'),
    /** Public media folder key of the cover photo. */
    imageKey: text('image_key'),
    originalPrice: bigint('original_price', { mode: 'number' }).notNull(),
    unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
    quantity: integer('quantity').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('order_items_seller_order_idx').on(t.sellerOrderId),
    check('order_items_quantity_positive', sql`${t.quantity} > 0`),
    check('order_items_prices_positive', sql`${t.unitPrice} > 0 AND ${t.originalPrice} > 0`),
  ],
);

/** Every status change of a seller order: who, when, why. Append-only. */
export const sellerOrderStatusHistory = pgTable(
  'seller_order_status_history',
  {
    id: id(),
    sellerOrderId: uuid('seller_order_id')
      .notNull()
      .references(() => sellerOrders.id, { onDelete: 'restrict' }),
    fromStatus: sellerOrderStatus('from_status'),
    toStatus: sellerOrderStatus('to_status').notNull(),
    actorType: auditActorType('actor_type').notNull(),
    actorId: uuid('actor_id'),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [index('seller_order_status_history_order_idx').on(t.sellerOrderId, t.createdAt)],
);
