import { Inject, Injectable } from '@nestjs/common';
import type { CheckoutRequest, OrderCreated } from '@lastsize/contracts';
import {
  and,
  customers,
  type Database,
  eq,
  orderItems,
  orders,
  OutOfStockError,
  reserveStock,
  sellerOrders,
  sellerOrderStatusHistory,
  sql,
  type Transaction,
} from '@lastsize/db';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { CodedConflictException } from '../common/coded-conflict.exception';
import { DATABASE } from '../infrastructure/infrastructure.module';
import { RateLimiterService } from '../security/rate-limiter.service';
import { ValidationFailedException } from '../security/zod-validation.pipe';
import { SyncScheduler } from '../sync/sync-queue';
import { CartService } from './cart.service';
import { OrderSecrets } from './order-secrets';

/** A store has this long to confirm a new order before it is cancelled and stock released. */
export const CONFIRM_WITHIN_HOURS = 24;
/** Without SMS these limits are the main defence against fake orders. */
const MAX_PENDING_ORDERS = 2;
const ORDERS_PER_IP = { name: 'order:ip', limit: 5, windowSeconds: 60 * 60 };
const ORDERS_PER_CUSTOMER = { name: 'order:customer', limit: 10, windowSeconds: 60 * 60 };

type Contact = { name: string; phone: string };
type Fulfillment = CheckoutRequest['fulfillment'][number];

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string }; code?: string }) ?? {};
  return cause.code === '23505' || cause.cause?.code === '23505';
}

@Injectable()
export class CheckoutService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly cart: CartService,
    private readonly secrets: OrderSecrets,
    private readonly rateLimiter: RateLimiterService,
    private readonly syncScheduler: SyncScheduler,
    private readonly audit: AuditService,
  ) {}

  /**
   * Turns the server cart into an order: one part per store, items frozen as a snapshot,
   * stock reserved atomically (all or nothing). Repeating a request with the same
   * Idempotency-Key returns the first order instead of creating another.
   */
  async place(
    customerId: string,
    input: { contact: Contact; fulfillment: Fulfillment[]; altcha: string },
    idempotencyKey: string,
    request: FastifyRequest,
  ): Promise<OrderCreated> {
    const repeated = await this.byIdempotencyKey(customerId, idempotencyKey);
    if (repeated) return repeated;

    if (!(await this.secrets.verifyAltcha(input.altcha)))
      throw new ValidationFailedException([{ path: 'altcha', message: 'altcha.invalid' }]);
    await this.rateLimiter.consume(ORDERS_PER_IP, request.ip);
    await this.rateLimiter.consume(ORDERS_PER_CUSTOMER, customerId);
    await this.assertFewPending(customerId, input.contact.phone);

    const { cart, lines } = await this.cart.view(customerId);
    if (lines.length === 0) throw new CodedConflictException('CART_CHANGED', 'Корзина пуста');
    const unavailable = cart.stores.flatMap((store) =>
      store.items
        .filter((item) => item.problem)
        .map((item) => ({ path: item.variantId, message: `cart.${item.problem}` })),
    );
    if (unavailable.length)
      throw new CodedConflictException(
        'CART_CHANGED',
        'Часть товаров закончилась или снята с продажи',
        unavailable,
      );
    const changed = cart.stores.flatMap((store) => store.items.filter((item) => item.priceChanged));
    if (changed.length) {
      await this.cart.acceptPrices(customerId);
      throw new CodedConflictException(
        'PRICE_CHANGED',
        'Цены изменились, проверьте заказ',
        changed.map((item) => ({ path: item.variantId, message: 'price.changed' })),
      );
    }

    // Exactly one choice per store in the cart, and only ways the store offers.
    const byStore = new Map(input.fulfillment.map((part) => [part.storeId, part]));
    if (
      byStore.size !== input.fulfillment.length ||
      byStore.size !== cart.stores.length ||
      cart.stores.some((store) => !byStore.has(store.storeId))
    )
      throw new CodedConflictException('CART_CHANGED', 'Магазины в корзине изменились');
    for (const store of cart.stores) {
      const part = byStore.get(store.storeId)!;
      const offered = part.type === 'PICKUP' ? store.pickupEnabled : store.deliveryEnabled;
      if (!offered)
        throw new ValidationFailedException([
          { path: `fulfillment.${store.storeId}`, message: 'fulfillment.unavailable' },
        ]);
    }

    const access = this.secrets.newAccessToken();
    let created: { id: string; number: number; storeIds: string[] };
    try {
      created = await this.db.transaction(async (tx) => {
        const [order] = await tx
          .insert(orders)
          .values({
            customerId,
            contactName: input.contact.name,
            contactPhone: input.contact.phone,
            accessTokenHash: access.hash,
            idempotencyKey,
            itemsTotal: cart.itemsTotal,
          })
          .returning({ id: orders.id, number: orders.number });
        await reserveStock(
          tx,
          lines.map(({ variantId, locationId, quantity }) => ({ variantId, locationId, quantity })),
          { refType: 'order', refId: order!.id },
        );
        for (const store of cart.stores) {
          const part = byStore.get(store.storeId)!;
          const [sellerOrder] = await tx
            .insert(sellerOrders)
            .values({
              orderId: order!.id,
              storeId: store.storeId,
              fulfillment: part.type,
              locationSnapshot: await this.locationSnapshot(tx, store.storeId),
              deliveryAddress: part.type === 'DELIVERY' ? part.address! : null,
              deliveryComment: part.comment || null,
              itemsTotal: store.itemsTotal,
              expiresAt: sql`now() + make_interval(hours => ${CONFIRM_WITHIN_HOURS})`,
            })
            .returning({ id: sellerOrders.id });
          await tx.insert(sellerOrderStatusHistory).values({
            sellerOrderId: sellerOrder!.id,
            fromStatus: null,
            toStatus: 'NEW',
            actorType: 'CUSTOMER',
            actorId: customerId,
          });
          await this.snapshotItems(
            tx,
            sellerOrder!.id,
            store.items.map(({ variantId, quantity, unitPrice }) => ({
              variantId,
              quantity,
              unitPrice,
            })),
          );
        }
        await tx.execute(sql`DELETE FROM cart_items WHERE customer_id = ${customerId}`);
        await tx
          .update(customers)
          .set({ name: input.contact.name, phone: input.contact.phone })
          .where(eq(customers.id, customerId));
        return { ...order!, storeIds: cart.stores.map((store) => store.storeId) };
      });
    } catch (error) {
      if (error instanceof OutOfStockError) {
        throw new CodedConflictException(
          'OUT_OF_STOCK',
          'Часть размеров только что закончилась',
          error.shortages.map((shortage) => ({
            path: shortage.variantId,
            message: 'stock.notEnough',
          })),
        );
      }
      // The same checkout submitted twice at once: the second waits and returns the first.
      if (isUniqueViolation(error)) {
        const first = await this.byIdempotencyKey(customerId, idempotencyKey);
        if (first) return first;
      }
      throw error;
    }

    // Reserved here, so marketplaces that take our counts must show less.
    for (const storeId of created.storeIds) await this.syncScheduler.storeStockChanged(storeId);
    await this.audit.record(
      {
        action: 'order.created',
        actorType: 'CUSTOMER',
        actorId: customerId,
        entityType: 'order',
        entityId: created.id,
        metadata: { number: created.number, stores: created.storeIds.length },
      },
      request,
    );
    return { number: created.number, accessToken: access.token };
  }

  private async byIdempotencyKey(customerId: string, key: string): Promise<OrderCreated | null> {
    const [existing] = await this.db
      .select({ number: orders.number })
      .from(orders)
      .where(and(eq(orders.customerId, customerId), eq(orders.idempotencyKey, key)));
    // The link token is shown only once; this device can open the order with its cookie.
    return existing ? { number: existing.number, accessToken: null } : null;
  }

  /** At most two orders waiting for confirmation per device and per phone number. */
  private async assertFewPending(customerId: string, phone: string): Promise<void> {
    const [row] = (
      await this.db.execute<{ pending: number }>(sql`
        SELECT count(DISTINCT o.id)::int AS pending
        FROM orders o JOIN seller_orders so ON so.order_id = o.id
        WHERE so.status = 'NEW' AND (o.customer_id = ${customerId} OR o.contact_phone = ${phone})`)
    ).rows;
    if ((row?.pending ?? 0) >= MAX_PENDING_ORDERS)
      throw new ValidationFailedException([{ path: 'form', message: 'orders.tooManyPending' }]);
  }

  private async locationSnapshot(executor: Transaction, storeId: string) {
    const [row] = (
      await executor.execute<{
        name: string;
        slug: string;
        address: string;
        city_id: number;
        phone: string;
      }>(sql`
        SELECT s.name, s.slug, l.address, l.city_id, l.phone
        FROM stores s JOIN store_locations l ON l.store_id = s.id WHERE s.id = ${storeId}`)
    ).rows;
    return {
      storeName: row!.name,
      storeSlug: row!.slug,
      address: row!.address,
      cityId: row!.city_id,
      phone: row!.phone,
    };
  }

  /** Freezes what is being bought: title, brand, size, photo and prices as they are now. */
  private async snapshotItems(
    executor: Transaction,
    sellerOrderId: string,
    items: { variantId: string; quantity: number; unitPrice: number }[],
  ): Promise<void> {
    const quantity = new Map(items.map((item) => [item.variantId, item.quantity]));
    const seenPrice = new Map(items.map((item) => [item.variantId, item.unitPrice]));
    const { rows } = await executor.execute<{
      variant_id: string;
      short_id: string;
      slug: string;
      title: string;
      brand: string | null;
      sku: string;
      size: string | null;
      color_id: number | null;
      image_key: string | null;
      original_price: string;
      sale_price: string;
    }>(sql`
      SELECT v.id AS variant_id, p.short_id, p.slug, p.title, b.name AS brand, v.sku,
             sv.code AS size, v.color_id, v.original_price, v.sale_price,
             (SELECT sm.base_key FROM product_images pi JOIN store_media sm ON sm.id = pi.media_id
              WHERE pi.product_id = p.id ORDER BY pi.position LIMIT 1) AS image_key
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN size_values sv ON sv.id = v.size_value_id
      WHERE v.id IN (${sql.join(
        items.map((item) => sql`${item.variantId}::uuid`),
        sql`, `,
      )})`);
    // A price changed between the cart check and now: roll the whole order back.
    if (rows.some((row) => Number(row.sale_price) !== seenPrice.get(row.variant_id)))
      throw new CodedConflictException('PRICE_CHANGED', 'Цены изменились, проверьте заказ');
    await executor.insert(orderItems).values(
      rows.map((row) => ({
        sellerOrderId,
        variantId: row.variant_id,
        productShortId: row.short_id,
        productSlug: row.slug,
        title: row.title,
        brand: row.brand,
        sku: row.sku,
        size: row.size,
        colorId: row.color_id,
        imageKey: row.image_key,
        originalPrice: Number(row.original_price),
        unitPrice: Number(row.sale_price),
        quantity: quantity.get(row.variant_id)!,
      })),
    );
  }
}
