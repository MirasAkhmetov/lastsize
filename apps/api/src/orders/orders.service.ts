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
  sellerOrders,
  sellerOrderStatusHistory,
  sql,
} from '@lastsize/db';
import { FINAL_STATUSES, overallOrderStatus, transitionSellerOrder } from '@lastsize/domain';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { DATABASE } from '../infrastructure/infrastructure.module';
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
          itemsTotal: part.itemsTotal,
          cancelReason: part.cancelReason,
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
      );
    });
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

  /** Stores that did not confirm in time: cancel and give the stock back. Run by the worker. */
  async expireUnconfirmed(): Promise<number> {
    const due = await this.db
      .select({ id: sellerOrders.id })
      .from(sellerOrders)
      .where(and(eq(sellerOrders.status, 'NEW'), lt(sellerOrders.expiresAt, sql`now()`)))
      .orderBy(asc(sellerOrders.expiresAt))
      .limit(EXPIRY_BATCH);
    const stores = new Set<string>();
    let cancelled = 0;
    for (const { id } of due) {
      // Each one on its own: a store confirming at this very moment wins, the rest go on.
      const result = await this.db
        .transaction((tx) =>
          applySellerOrderTransition(
            tx,
            id,
            'cancel',
            { type: 'SYSTEM', id: null },
            'system.notConfirmed',
          ),
        )
        .catch(() => null);
      if (!result) continue;
      cancelled += 1;
      stores.add(result.storeId);
    }
    for (const storeId of stores) await this.syncScheduler.storeStockChanged(storeId);
    return cancelled;
  }

  // ───────────────────────── seller ─────────────────────────

  async sellerList(
    storeId: string,
    status: SellerOrderStatus | undefined,
    limit: number,
    offset: number,
  ): Promise<SellerOrderList> {
    const where = and(
      eq(sellerOrders.storeId, storeId),
      status ? eq(sellerOrders.status, status) : undefined,
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
      this.db.select({ total: count() }).from(sellerOrders).where(where),
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
      cancelReason: part.cancelReason,
      items: items.map((item) => ({ ...itemView(item), sku: item.sku })),
      history: history.map((entry) => ({
        status: entry.toStatus,
        at: entry.createdAt.toISOString(),
        by: entry.actorType,
        reason: entry.reason,
      })),
    };
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
