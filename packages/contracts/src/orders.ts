import { z } from 'zod';
import { kzPhoneSchema } from './phone.js';
import { mediaSchema } from './products.js';

export const MAX_CART_QUANTITY = 10;

// ───────────────────────── cart ─────────────────────────

export const cartItemProblemSchema = z.enum(['unavailable', 'notEnough']);

export const cartItemSchema = z.object({
  variantId: z.uuid(),
  productPath: z.string(),
  title: z.string(),
  brand: z.string().nullable(),
  size: z.string().nullable(),
  image: mediaSchema.nullable(),
  quantity: z.number().int(),
  /** Free stock right now (on hand − reserved). */
  available: z.number().int(),
  unitPrice: z.number().int(),
  originalPrice: z.number().int(),
  discountPercent: z.number().int(),
  /** The price was different when the item was added. */
  priceChanged: z.boolean(),
  previousPrice: z.number().int(),
  problem: cartItemProblemSchema.nullable(),
});
export type CartItem = z.infer<typeof cartItemSchema>;

export const cartStoreSchema = z.object({
  storeId: z.uuid(),
  name: z.string(),
  slug: z.string(),
  address: z.string(),
  pickupEnabled: z.boolean(),
  deliveryEnabled: z.boolean(),
  items: z.array(cartItemSchema),
  itemsTotal: z.number().int(),
});
export type CartStore = z.infer<typeof cartStoreSchema>;

export const cartSchema = z.object({
  stores: z.array(cartStoreSchema),
  itemCount: z.number().int(),
  itemsTotal: z.number().int(),
  /** Something must be fixed before checkout (sold out, removed). */
  hasProblems: z.boolean(),
});
export type Cart = z.infer<typeof cartSchema>;

export const cartCountSchema = z.object({ count: z.number().int() });

export const addCartItemRequestSchema = z.strictObject({ variantId: z.uuid() });
export const updateCartItemRequestSchema = z.strictObject({
  quantity: z
    .number()
    .int('quantity.invalid')
    .min(1, 'quantity.invalid')
    .max(MAX_CART_QUANTITY, 'quantity.tooMany'),
});

// ───────────────────────── checkout ─────────────────────────

export const FULFILLMENT_TYPES = ['PICKUP', 'DELIVERY'] as const;
export const fulfillmentTypeSchema = z.enum(FULFILLMENT_TYPES);

export const checkoutRequestSchema = z.strictObject({
  contact: z.strictObject({
    name: z.string().trim().min(2, 'name.tooShort').max(60, 'name.tooLong'),
    phone: kzPhoneSchema,
  }),
  /** How each store's part is received. Items and prices always come from the server cart. */
  fulfillment: z
    .array(
      z
        .strictObject({
          storeId: z.uuid(),
          type: fulfillmentTypeSchema,
          address: z.string().trim().max(300, 'address.tooLong').optional(),
          comment: z.string().trim().max(300, 'comment.tooLong').optional(),
        })
        .refine((part) => part.type === 'PICKUP' || (part.address?.length ?? 0) >= 5, {
          message: 'address.required',
          path: ['address'],
        }),
    )
    .min(1)
    .max(20),
  /** ALTCHA proof-of-work payload (anti-spam without SMS). */
  altcha: z.string().min(1, 'altcha.required').max(20_000),
});
export type CheckoutRequest = z.input<typeof checkoutRequestSchema>;

export const orderCreatedSchema = z.object({
  number: z.number().int(),
  /** Shown once: the order link that opens the order on any device (null on a repeated submit). */
  accessToken: z.string().nullable(),
});
export type OrderCreated = z.infer<typeof orderCreatedSchema>;

// ───────────────────────── orders ─────────────────────────

export const SELLER_ORDER_STATUSES = [
  'NEW',
  'CONFIRMED',
  'READY_FOR_PICKUP',
  'COURIER_REQUESTED',
  'HANDED_TO_COURIER',
  'COMPLETED',
  'CANCELLED',
] as const;
export const sellerOrderStatusSchema = z.enum(SELLER_ORDER_STATUSES);
export type SellerOrderStatus = z.infer<typeof sellerOrderStatusSchema>;
export const orderOverallStatusSchema = z.enum([
  'AWAITING_CONFIRMATION',
  'IN_PROGRESS',
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'CANCELLED',
]);

export const PAYMENT_STATUSES = ['UNPAID', 'PAID_TO_SELLER'] as const;
export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);
export const REFUND_METHODS = ['CASH', 'KASPI', 'CARD'] as const;
export const refundMethodSchema = z.enum(REFUND_METHODS);

export const returnRecordSchema = z.object({
  title: z.string(),
  size: z.string().nullable(),
  quantity: z.number().int(),
  status: z.enum(['ACCEPTED', 'REJECTED']),
  reason: z.string().nullable(),
  refundMethod: refundMethodSchema.nullable(),
  at: z.iso.datetime({ offset: true }),
});

export const orderItemSchema = z.object({
  productPath: z.string(),
  title: z.string(),
  brand: z.string().nullable(),
  size: z.string().nullable(),
  image: mediaSchema.nullable(),
  unitPrice: z.number().int(),
  originalPrice: z.number().int(),
  quantity: z.number().int(),
});

export const orderPartSchema = z.object({
  id: z.uuid(),
  store: z.object({
    name: z.string(),
    slug: z.string(),
    address: z.string(),
    phone: z.string(),
  }),
  status: sellerOrderStatusSchema,
  fulfillment: fulfillmentTypeSchema,
  deliveryAddress: z.string().nullable(),
  deliveryComment: z.string().nullable(),
  courierFee: z.number().int().nullable(),
  courierTrackingUrl: z.string().nullable(),
  paymentStatus: paymentStatusSchema,
  itemsTotal: z.number().int(),
  cancelReason: z.string().nullable(),
  /** Until when a ready pickup order waits at the store. */
  pickupBy: z.iso.datetime({ offset: true }).nullable(),
  /** Until when the goods can be brought back (completed orders). */
  returnBy: z.iso.datetime({ offset: true }).nullable(),
  returns: z.array(returnRecordSchema),
  /** 4 digits to say at the store counter; only for pickup orders still open. */
  pickupCode: z.string().nullable(),
  /** Until when the store has to confirm (NEW only). */
  confirmBy: z.iso.datetime({ offset: true }).nullable(),
  canCancel: z.boolean(),
  items: z.array(orderItemSchema),
  history: z.array(
    z.object({ status: sellerOrderStatusSchema, at: z.iso.datetime({ offset: true }) }),
  ),
});
export type OrderPart = z.infer<typeof orderPartSchema>;

export const orderDetailSchema = z.object({
  number: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }),
  contactName: z.string(),
  contactPhone: z.string(),
  status: orderOverallStatusSchema,
  itemsTotal: z.number().int(),
  parts: z.array(orderPartSchema),
});
export type OrderDetail = z.infer<typeof orderDetailSchema>;

export const orderSummarySchema = z.object({
  number: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }),
  status: orderOverallStatusSchema,
  itemsTotal: z.number().int(),
  itemCount: z.number().int(),
  storeNames: z.array(z.string()),
  images: z.array(mediaSchema),
});
export const orderListSchema = z.array(orderSummarySchema);
export type OrderSummary = z.infer<typeof orderSummarySchema>;

export const orderAccessQuerySchema = z.object({
  /** Order-link token, for opening the order on another device. */
  t: z
    .string()
    .regex(/^[A-Za-z0-9_-]{20,64}$/)
    .optional(),
});

// ───────────────────────── seller ─────────────────────────

export const sellerOrderListItemSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }),
  status: sellerOrderStatusSchema,
  fulfillment: fulfillmentTypeSchema,
  contactName: z.string(),
  contactPhone: z.string(),
  itemsTotal: z.number().int(),
  itemCount: z.number().int(),
  confirmBy: z.iso.datetime({ offset: true }).nullable(),
});
export const sellerOrderListSchema = z.object({
  items: z.array(sellerOrderListItemSchema),
  total: z.number().int(),
  counts: z.record(sellerOrderStatusSchema, z.number().int()),
});
export type SellerOrderList = z.infer<typeof sellerOrderListSchema>;

export const STORE_ACTIONS = [
  'confirm',
  'readyForPickup',
  'markPaid',
  'requestCourier',
  'handToCourier',
  'complete',
  'cancel',
] as const;
export const storeActionSchema = z.enum(STORE_ACTIONS);
export type StoreAction = z.infer<typeof storeActionSchema>;

export const STORE_CANCEL_REASONS = [
  'store.outOfStock',
  'store.customerUnreachable',
  'store.customerRefused',
  'store.other',
] as const;

export const sellerOrderDetailSchema = sellerOrderListItemSchema.extend({
  deliveryAddress: z.string().nullable(),
  deliveryComment: z.string().nullable(),
  courierFee: z.number().int().nullable(),
  courierTrackingUrl: z.string().nullable(),
  paymentStatus: paymentStatusSchema,
  cancelReason: z.string().nullable(),
  pickupBy: z.iso.datetime({ offset: true }).nullable(),
  returnBy: z.iso.datetime({ offset: true }).nullable(),
  /** What the store can do now (the server checks again on every action). */
  actions: z.array(storeActionSchema),
  canProcessReturn: z.boolean(),
  returns: z.array(returnRecordSchema),
  items: z.array(
    orderItemSchema.extend({
      id: z.uuid(),
      sku: z.string(),
      /** Units already taken back. */
      returnedQuantity: z.number().int(),
    }),
  ),
  history: z.array(
    z.object({
      status: sellerOrderStatusSchema,
      at: z.iso.datetime({ offset: true }),
      by: z.enum(['USER', 'CUSTOMER', 'SYSTEM', 'ANONYMOUS']),
      reason: z.string().nullable(),
    }),
  ),
});
export type SellerOrderDetail = z.infer<typeof sellerOrderDetailSchema>;

export const sellerOrderListQuerySchema = z.object({
  status: sellerOrderStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const sellerOrderListQuerySchemaWithSearch = sellerOrderListQuerySchema.extend({
  /** Order number or a part of the buyer's phone, for finding an order at the counter. */
  q: z
    .string()
    .trim()
    .regex(/^[\d +()-]{3,20}$/)
    .optional(),
});

const tiyn = z
  .number()
  .int('price.notWholeTenge')
  .min(0, 'price.salePositive')
  .max(1_000_000_00, 'price.tooHigh')
  .refine((value) => value % 100 === 0, { message: 'price.notWholeTenge' });

export const storeActionRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('confirm') }),
  z.strictObject({ action: z.literal('readyForPickup') }),
  z.strictObject({ action: z.literal('markPaid') }),
  z.strictObject({
    action: z.literal('requestCourier'),
    /** What the courier costs; the buyer pays it, the store has already billed it. */
    courierFee: tiyn,
    trackingUrl: z
      .url({ protocol: /^https$/, error: 'url.invalid' })
      .max(500, 'url.invalid')
      .optional(),
  }),
  z.strictObject({ action: z.literal('handToCourier') }),
  z.strictObject({
    action: z.literal('complete'),
    /** Pickup only: the 4 digits the buyer says at the counter. */
    pickupCode: z
      .string()
      .regex(/^\d{4}$/, 'pickupCode.invalid')
      .optional(),
  }),
  z.strictObject({ action: z.literal('cancel'), reason: z.enum(STORE_CANCEL_REASONS) }),
]);
export type StoreActionRequest = z.input<typeof storeActionRequestSchema>;

export const returnRequestSchema = z
  .strictObject({
    items: z
      .array(
        z.strictObject({
          orderItemId: z.uuid(),
          quantity: z.number().int().min(1, 'quantity.invalid').max(10, 'quantity.invalid'),
        }),
      )
      .min(1, 'return.noItems')
      .max(50),
    decision: z.enum(['accept', 'reject']),
    refundMethod: refundMethodSchema.optional(),
    reason: z.string().trim().max(300, 'return.reasonTooLong').optional(),
  })
  .refine((body) => body.decision !== 'accept' || body.refundMethod !== undefined, {
    message: 'return.refundMethodRequired',
    path: ['refundMethod'],
  })
  .refine((body) => body.decision !== 'reject' || (body.reason?.length ?? 0) >= 3, {
    message: 'return.reasonRequired',
    path: ['reason'],
  });
export type ReturnRequest = z.input<typeof returnRequestSchema>;
