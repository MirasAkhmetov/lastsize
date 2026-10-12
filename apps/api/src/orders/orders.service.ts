import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type OrderDetail,
  type OrderSummary,
  productPath,
  SELLER_ORDER_STATUSES,
  type SellerOrderDetail,
  type SellerOrderList,
  type SellerOrderStatus,
} from '@lastsize/contracts';
import {
  and,
  asc,
  count,
  type Database,
  desc,
  eq,
  inArray,
  lt,
  orderItems,
  orders,
  returnItems,
  sellerOrders,
  sellerOrderStatusHistory,
  sql,
} from '@lastsize/db';
import {
  canAcceptReturn,
  FINAL_STATUSES,
  overallOrderStatus,
  returnDeadline,
  storeActions,
  transitionSellerOrder,
} from '@lastsize/domain';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { DATABASE } from '../infrastructure/infrastructure.module';
import { NotificationsService } from '../notifications/notifications.service';
import { IMAGE_WIDTHS } from '../media/image-processor';
import { mediaUrl } from '../media/media.service';
import { SyncScheduler } from '../sync/sync-queue';
import { accessTokenMatches, OrderSecrets } from './order-secrets';
import { applySellerOrderTransition } from './seller-order-transitions';

type OrderRow = typeof orders.$inferSelect;
type ItemRow = typeof orderItems.$inferSelect;

/** Snapshot photos keep their stored key; sizes are always the standard set. */
function snapshotImage(key: string | null) {
  return key
    ? {
        id: key.split('/').at(-1)!,
        url: mediaUrl(key),
        widths: [...IMAGE_WIDTHS],
        width: 0,
        height: 0,
      }
    : null;
}

function itemView(item: ItemRow) {
  return {
    productPath: productPath({ slug: item.productSlug, shortId: item.productShortId }),
    title: item.title,
    brand: item.brand,
    size: item.size,
    image: snapshotImage(item.imageKey),
    unitPrice: item.unitPrice,
    originalPrice: item.originalPrice,
    quantity: item.quantity,
  };
}

const EXPIRY_BATCH = 100;

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly secrets: OrderSecrets,
    private readonly syncScheduler: SyncScheduler,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────────────────────── buyer ─────────────────────────

  async listForCustomer(customerId: string | null): Promise<OrderSummary[]> {
    if (!customerId) return [];
    const list = await this.db
      .select()
      .from(orders)
      .where(eq(orders.customerId, customerId))
      .orderBy(desc(orders.createdAt))
      .limit(50);
    if (list.length === 0) return [];
    const parts = await this.db
      .select({
        id: sellerOrders.id,
        orderId: sellerOrders.orderId,
        status: sellerOrders.status,
        location: sellerOrders.locationSnapshot,
      })
      .from(sellerOrders)
      .where(
        inArray(
          sellerOrders.orderId,
          list.map((order) => order.id),
        ),
      );
    const items = await this.db
      .select()
      .from(orderItems)
      .where(
        inArray(
          orderItems.sellerOrderId,
          parts.map((part) => part.id),
        ),
      );
    return list.map((order) => {
      const own = parts.filter((part) => part.orderId === order.id);
      const ownItems = items.filter((item) => own.some((part) => part.id === item.sellerOrderId));
      return {
        number: order.number,
        createdAt: order.createdAt.toISOString(),
        status: overallOrderStatus(own.map((part) => part.status)),
        itemsTotal: order.itemsTotal,
        itemCount: ownItems.reduce((sum, item) => sum + item.quantity, 0),
        storeNames: own.map((part) => part.location.storeName),
        images: ownItems
          .map((item) => snapshotImage(item.imageKey))
          .filter((image) => image !== null)
          .slice(0, 4),
      };
    });
  }

  /**
   * An order opens for the device that placed it, or for anyone with the order-link token.
   * Anything else is "not found", so numbers cannot be probed.
   */
  async detail(
    number: number,
    access: { customerId: string | null; token?: string },
  ): Promise<OrderDetail> {
    const order = await this.accessible(number, access);
    const parts = await this.db
      .select()
      .from(sellerOrders)
      .where(eq(sellerOrders.orderId, order.id))
      .orderBy(asc(sellerOrders.createdAt));
    const ids = parts.map((part) => part.id);
    const [items, history] = await Promise.all([
      this.db
        .select()
        .from(orderItems)
        .where(inArray(orderItems.sellerOrderId, ids))
        .orderBy(asc(orderItems.createdAt)),
      this.db
        .select()
        .from(sellerOrderStatusHistory)
        .where(inArray(sellerOrderStatusHistory.sellerOrderId, ids))
        .orderBy(asc(sellerOrderStatusHistory.createdAt)),
    ]);
    const returns = await this.returnsFor(items);
    return {
      number: order.number,
      createdAt: order.createdAt.toISOString(),
      contactName: order.contactName,
      contactPhone: order.contactPhone,
      status: overallOrderStatus(parts.map((part) => part.status)),
      itemsTotal: order.itemsTotal,
      parts: parts.map((part) => {
        const open = !FINAL_STATUSES.includes(part.status);
        return {
          id: part.id,
          store: {
            name: part.locationSnapshot.storeName,
            slug: part.locationSnapshot.storeSlug,
            address: part.locationSnapshot.address,
            phone: part.locationSnapshot.phone,
          },
          status: part.status,
          fulfillment: part.fulfillment,
          deliveryAddress: part.deliveryAddress,
          deliveryComment: part.deliveryComment,
          courierFee: part.courierFee,
          courierTrackingUrl: part.courierTrackingUrl,
          paymentStatus: part.paymentStatus,
          itemsTotal: part.itemsTotal,
          cancelReason: part.cancelReason,
          pickupBy: part.status === 'READY_FOR_PICKUP' ? part.expiresAt.toISOString() : null,
          returnBy: part.completedAt ? returnDeadline(part.completedAt).toISOString() : null,
          returns: returns
            .filter((entry) => entry.sellerOrderId === part.id)
            .map(({ sellerOrderId: _, orderItemId: __, ...entry }) => entry),
          pickupCode:
            part.fulfillment === 'PICKUP' && open ? this.secrets.pickupCode(part.id) : null,
          confirmBy: part.status === 'NEW' ? part.expiresAt.toISOString() : null,
          canCancel: transitionSellerOrder('cancel', part, 'CUSTOMER') !== null,
          items: items.filter((item) => item.sellerOrderId === part.id).map(itemView),
          history: history
            .filter((entry) => entry.sellerOrderId === part.id)
            .map((entry) => ({ status: entry.toStatus, at: entry.createdAt.toISOString() })),
        };
      }),
    };
  }

  /** The buyer changed their mind before the store confirmed: the reservation is released. */
  async cancelByCustomer(
    number: number,
    partId: string,
    access: { customerId: string | null; token?: string },
    request: FastifyRequest,
  ): Promise<void> {
    const order = await this.accessible(number, access);
    const result = await this.db.transaction(async (tx) => {
      const [part] = await tx
        .select({ id: sellerOrders.id })
        .from(sellerOrders)
        .where(and(eq(sellerOrders.id, partId), eq(sellerOrders.orderId, order.id)));
      if (!part) throw new NotFoundException('Заказ не найден');
      return applySellerOrderTransition(
        tx,
        part.id,
        'cancel',
        { type: 'CUSTOMER', id: order.customerId },
        'customer.cancelled',
        this.notifications,
      );
    });
    await this.notifications.published(result.notifications);
    await this.syncScheduler.storeStockChanged(result.storeId);
    await this.audit.record(
      {
        action: 'order.cancelled_by_customer',
        actorType: 'CUSTOMER',
        actorId: order.customerId,
        entityType: 'seller_order',
        entityId: partId,
      },
      request,
    );
  }

  /**
   * Overdue orders: not confirmed within 24 hours, or a ready pickup not collected within
   * 48 hours. They are cancelled and the stock goes back on sale. Run by the worker.
   */
  async expireOverdue(): Promise<number> {
    const due = await this.db
      .select({ id: sellerOrders.id, status: sellerOrders.status })
      .from(sellerOrders)
      .where(
        and(
          inArray(sellerOrders.status, ['NEW', 'READY_FOR_PICKUP']),
          lt(sellerOrders.expiresAt, sql`now()`),
        ),
      )
      .orderBy(asc(sellerOrders.expiresAt))
      .limit(EXPIRY_BATCH);
    const stores = new Set<string>();
    let cancelled = 0;
    for (const { id, status } of due) {
      // Each one on its own: a store acting at this very moment wins, the rest go on.
      const result = await this.db
        .transaction((tx) =>
          applySellerOrderTransition(
            tx,
            id,
            'cancel',
            { type: 'SYSTEM', id: null },
            status === 'NEW' ? 'system.notConfirmed' : 'system.notPickedUp',
            this.notifications,
          ),
        )
        .catch(() => null);
      if (!result) continue;
      await this.notifications.published(result.notifications);
      cancelled += 1;
      stores.add(result.storeId);
    }
    for (const storeId of stores) await this.syncScheduler.storeStockChanged(storeId);
    return cancelled;
  }

  /** Two hours without an answer: remind the store once (Telegram, push, notification centre). */
  async remindUnconfirmed(): Promise<number> {
    const due = await this.db.execute<{ id: string; store_id: string; number: string }>(sql`
      SELECT so.id, so.store_id, o.number
      FROM seller_orders so JOIN orders o ON o.id = so.order_id
      WHERE so.status = 'NEW' AND so.created_at < now() - interval '2 hours'
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.recipient_type = 'STORE' AND n.recipient_id = so.store_id
            AND n.type = 'order.reminder' AND n.params->>'sellerOrderId' = so.id::text)
      LIMIT ${EXPIRY_BATCH}`);
    for (const row of due.rows) {
      const created = await this.db.transaction((tx) =>
        this.notifications.create(
          tx,
          { type: 'STORE', id: row.store_id },
          'order.reminder',
          { number: Number(row.number), sellerOrderId: row.id },
          `/seller/orders/${row.id}`,
        ),
      );
      await this.notifications.published([created]);
    }
    return due.rows.length;
  }

  // ───────────────────────── seller ─────────────────────────

  async sellerList(
    storeId: string,
    status: SellerOrderStatus | undefined,
    limit: number,
    offset: number,
    query?: string,
  ): Promise<SellerOrderList> {
    // At the counter: find by order number or by the last digits of the buyer's phone.
    const digits = query?.replace(/\D/g, '') ?? '';
    const search = digits
      ? sql`(${orders.number}::text = ${digits} OR ${orders.contactPhone} LIKE ${`%${digits}%`})`
      : undefined;
    const where = and(
      eq(sellerOrders.storeId, storeId),
      status ? eq(sellerOrders.status, status) : undefined,
      search,
    );
    const [rows, [{ total } = { total: 0 }], statusCounts] = await Promise.all([
      this.db
        .select({
          id: sellerOrders.id,
          number: orders.number,
          createdAt: sellerOrders.createdAt,
          status: sellerOrders.status,
          fulfillment: sellerOrders.fulfillment,
          contactName: orders.contactName,
          contactPhone: orders.contactPhone,
          itemsTotal: sellerOrders.itemsTotal,
          expiresAt: sellerOrders.expiresAt,
          itemCount: sql<number>`(SELECT coalesce(sum(quantity), 0)::int FROM order_items oi WHERE oi.seller_order_id = ${sellerOrders.id})`,
        })
        .from(sellerOrders)
        .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
        .where(where)
        .orderBy(desc(sellerOrders.createdAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ total: count() })
        .from(sellerOrders)
        .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
        .where(where),
      this.db
        .select({ status: sellerOrders.status, total: count() })
        .from(sellerOrders)
        .where(eq(sellerOrders.storeId, storeId))
        .groupBy(sellerOrders.status),
    ]);
    return {
      items: rows.map(({ expiresAt, ...row }) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        confirmBy: row.status === 'NEW' ? expiresAt.toISOString() : null,
      })),
      total,
      counts: Object.fromEntries(
        SELLER_ORDER_STATUSES.map((value) => [
          value,
          statusCounts.find((row) => row.status === value)?.total ?? 0,
        ]),
      ) as SellerOrderList['counts'],
    };
  }

  async sellerDetail(storeId: string, sellerOrderId: string): Promise<SellerOrderDetail> {
    const [row] = await this.db
      .select({ part: sellerOrders, order: orders })
      .from(sellerOrders)
      .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
      .where(and(eq(sellerOrders.id, sellerOrderId), eq(sellerOrders.storeId, storeId)));
    if (!row) throw new NotFoundException('Заказ не найден');
    const { part, order } = row;
    const [items, history] = await Promise.all([
      this.db
        .select()
        .from(orderItems)
        .where(eq(orderItems.sellerOrderId, part.id))
        .orderBy(asc(orderItems.createdAt)),
      this.db
        .select()
        .from(sellerOrderStatusHistory)
        .where(eq(sellerOrderStatusHistory.sellerOrderId, part.id))
        .orderBy(asc(sellerOrderStatusHistory.createdAt)),
    ]);
    const returns = await this.returnsFor(items);
    return {
      id: part.id,
      number: order.number,
      createdAt: part.createdAt.toISOString(),
      status: part.status,
      fulfillment: part.fulfillment,
      contactName: order.contactName,
      contactPhone: order.contactPhone,
      itemsTotal: part.itemsTotal,
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
      confirmBy: part.status === 'NEW' ? part.expiresAt.toISOString() : null,
      deliveryAddress: part.deliveryAddress,
      deliveryComment: part.deliveryComment,
      courierFee: part.courierFee,
      courierTrackingUrl: part.courierTrackingUrl,
      paymentStatus: part.paymentStatus,
      cancelReason: part.cancelReason,
      pickupBy: part.status === 'READY_FOR_PICKUP' ? part.expiresAt.toISOString() : null,
      returnBy: part.completedAt ? returnDeadline(part.completedAt).toISOString() : null,
      actions: storeActions(part),
      canProcessReturn: part.status === 'COMPLETED' && canAcceptReturn(part.completedAt),
      returns: returns.map(({ sellerOrderId: _, orderItemId: __, ...entry }) => entry),
      items: items.map((item) => ({
        ...itemView(item),
        id: item.id,
        sku: item.sku,
        returnedQuantity: returns
          .filter((entry) => entry.orderItemId === item.id && entry.status === 'ACCEPTED')
          .reduce((sum, entry) => sum + entry.quantity, 0),
      })),
      history: history.map((entry) => ({
        status: entry.toStatus,
        at: entry.createdAt.toISOString(),
        by: entry.actorType,
        reason: entry.reason,
      })),
    };
  }

  private async returnsFor(items: ItemRow[]) {
    if (items.length === 0) return [];
    const rows = await this.db
      .select()
      .from(returnItems)
      .where(
        inArray(
          returnItems.orderItemId,
          items.map((item) => item.id),
        ),
      )
      .orderBy(asc(returnItems.createdAt));
    return rows.map((row) => {
      const item = items.find((candidate) => candidate.id === row.orderItemId)!;
      return {
        sellerOrderId: item.sellerOrderId,
        orderItemId: row.orderItemId,
        title: item.title,
        size: item.size,
        quantity: row.quantity,
        status: row.status,
        reason: row.reason,
        refundMethod: row.refundMethod,
        at: row.createdAt.toISOString(),
      };
    });
  }

  private async accessible(
    number: number,
    access: { customerId: string | null; token?: string },
  ): Promise<OrderRow> {
    const [order] = await this.db.select().from(orders).where(eq(orders.number, number));
    const allowed =
      order &&
      ((access.customerId !== null && order.customerId === access.customerId) ||
        (access.token !== undefined && accessTokenMatches(access.token, order.accessTokenHash)));
    if (!allowed) throw new NotFoundException('Заказ не найден');
    return order;
  }
}
