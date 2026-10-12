import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AdminOrderDetail,
  AdminOrderList,
  BlockedPhone,
  IntegrationHealth,
  SellerOrderStatus,
  SuspiciousPhone,
} from '@lastsize/contracts';
import {
  and,
  blockedPhones,
  count,
  type Database,
  desc,
  eq,
  orders,
  sellerOrders,
  sql,
  stores,
} from '@lastsize/db';
import { transitionSellerOrder } from '@lastsize/domain';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { DATABASE } from '../infrastructure/infrastructure.module';
import { NotificationsService } from '../notifications/notifications.service';
import { OrdersService } from '../orders/orders.service';
import { applySellerOrderTransition } from '../orders/seller-order-transitions';
import { SyncScheduler } from '../sync/sync-queue';

type Actor = { userId: string; request: FastifyRequest };

/** Cancellations that point at the buyer, not the store. */
const BUYER_PROBLEMS = `('store.customerUnreachable', 'store.customerRefused', 'system.notPickedUp')`;

/**
 * Platform operations: every order across stores (disputes and fraud), numbers used for fake
 * orders, and the health of marketplace syncs.
 */
@Injectable()
export class OperationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly ordersService: OrdersService,
    private readonly notifications: NotificationsService,
    private readonly syncScheduler: SyncScheduler,
    private readonly audit: AuditService,
  ) {}

  async orders(
    status: SellerOrderStatus | undefined,
    query: string | undefined,
    limit: number,
    offset: number,
  ): Promise<AdminOrderList> {
    const digits = query?.replace(/\D/g, '') ?? '';
    const where = and(
      status ? eq(sellerOrders.status, status) : undefined,
      digits
        ? sql`(${orders.number}::text = ${digits} OR ${orders.contactPhone} LIKE ${`%${digits}%`})`
        : undefined,
    );
    const [rows, [{ total } = { total: 0 }]] = await Promise.all([
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
          storeId: stores.id,
          storeName: stores.name,
          itemCount: sql<number>`(SELECT coalesce(sum(quantity), 0)::int FROM order_items oi WHERE oi.seller_order_id = ${sellerOrders.id})`,
        })
        .from(sellerOrders)
        .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
        .innerJoin(stores, eq(stores.id, sellerOrders.storeId))
        .where(where)
        .orderBy(desc(sellerOrders.createdAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ total: count() })
        .from(sellerOrders)
        .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
        .where(where),
    ]);
    return {
      items: rows.map(({ expiresAt, ...row }) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        confirmBy: row.status === 'NEW' ? expiresAt.toISOString() : null,
      })),
      total,
    };
  }

  async order(sellerOrderId: string): Promise<AdminOrderDetail> {
    const [row] = await this.db
      .select({
        storeId: sellerOrders.storeId,
        storeName: stores.name,
        status: sellerOrders.status,
        fulfillment: sellerOrders.fulfillment,
        phone: orders.contactPhone,
      })
      .from(sellerOrders)
      .innerJoin(stores, eq(stores.id, sellerOrders.storeId))
      .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
      .where(eq(sellerOrders.id, sellerOrderId));
    if (!row) throw new NotFoundException('Заказ не найден');
    const detail = await this.ordersService.sellerDetail(row.storeId, sellerOrderId);
    const [blocked] = await this.db
      .select({ phone: blockedPhones.phone })
      .from(blockedPhones)
      .where(eq(blockedPhones.phone, row.phone));
    const [problems] = (
      await this.db.execute<{ total: string }>(sql`
        SELECT count(*) AS total FROM seller_orders so JOIN orders o ON o.id = so.order_id
        WHERE o.contact_phone = ${row.phone} AND so.created_at >= now() - interval '90 days'
          AND so.cancel_reason IN ${sql.raw(BUYER_PROBLEMS)}`)
    ).rows;
    return {
      ...detail,
      storeId: row.storeId,
      storeName: row.storeName,
      phoneBlocked: Boolean(blocked),
      phoneProblems: Number(problems?.total ?? 0),
      canCancel: transitionSellerOrder('cancel', row, 'ADMIN') !== null,
    };
  }

  /** A dispute or fraud: the platform cancels; stock and both sides are handled as usual. */
  async cancelOrder(sellerOrderId: string, note: string, actor: Actor): Promise<void> {
    const result = await this.db.transaction((tx) =>
      applySellerOrderTransition(
        tx,
        sellerOrderId,
        'cancel',
        { type: 'ADMIN', id: actor.userId },
        'admin.cancelled',
        this.notifications,
      ),
    );
    await this.notifications.published(result.notifications);
    await this.syncScheduler.storeStockChanged(result.storeId);
    await this.audit.record(
      {
        action: 'admin.order_cancelled',
        actorType: 'USER',
        actorId: actor.userId,
        entityType: 'seller_order',
        entityId: sellerOrderId,
        metadata: { note },
      },
      actor.request,
    );
  }

  /**
   * Numbers stores could not complete orders for (never answered, refused, never came):
   * three or more such orders in 90 days put the number on the review list.
   */
  async suspiciousPhones(): Promise<SuspiciousPhone[]> {
    const { rows } = await this.db.execute<{
      phone: string;
      orders: string;
      unreachable: string;
      not_picked_up: string;
      refused: string;
      last_order_at: Date;
      blocked: boolean;
    }>(sql`
      SELECT o.contact_phone AS phone,
             count(*) AS orders,
             count(*) FILTER (WHERE so.cancel_reason = 'store.customerUnreachable') AS unreachable,
             count(*) FILTER (WHERE so.cancel_reason = 'system.notPickedUp') AS not_picked_up,
             count(*) FILTER (WHERE so.cancel_reason = 'store.customerRefused') AS refused,
             max(so.created_at) AS last_order_at,
             EXISTS (SELECT 1 FROM blocked_phones b WHERE b.phone = o.contact_phone) AS blocked
      FROM seller_orders so JOIN orders o ON o.id = so.order_id
      WHERE so.created_at >= now() - interval '90 days'
      GROUP BY o.contact_phone
      HAVING count(*) FILTER (WHERE so.cancel_reason IN ${sql.raw(BUYER_PROBLEMS)}) >= 3
      ORDER BY count(*) FILTER (WHERE so.cancel_reason IN ${sql.raw(BUYER_PROBLEMS)}) DESC
      LIMIT 100`);
    return rows.map((row) => ({
      phone: row.phone,
      orders: Number(row.orders),
      unreachable: Number(row.unreachable),
      notPickedUp: Number(row.not_picked_up),
      refused: Number(row.refused),
      lastOrderAt: new Date(row.last_order_at).toISOString(),
      blocked: row.blocked,
    }));
  }

  async blockedList(): Promise<BlockedPhone[]> {
    const rows = await this.db.select().from(blockedPhones).orderBy(desc(blockedPhones.createdAt));
    return rows.map((row) => ({
      phone: row.phone,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async block(phone: string, reason: string, actor: Actor): Promise<void> {
    await this.db
      .insert(blockedPhones)
      .values({ phone, reason, blockedBy: actor.userId })
      .onConflictDoUpdate({
        target: blockedPhones.phone,
        set: { reason, blockedBy: actor.userId },
      });
    await this.audit.record(
      {
        action: 'phone.blocked',
        actorType: 'USER',
        actorId: actor.userId,
        entityType: 'phone',
        metadata: { phone, reason },
      },
      actor.request,
    );
  }

  async unblock(phone: string, actor: Actor): Promise<void> {
    const [removed] = await this.db
      .delete(blockedPhones)
      .where(eq(blockedPhones.phone, phone))
      .returning({ phone: blockedPhones.phone });
    if (!removed) throw new NotFoundException('Номер не заблокирован');
    await this.audit.record(
      {
        action: 'phone.unblocked',
        actorType: 'USER',
        actorId: actor.userId,
        entityType: 'phone',
        metadata: { phone },
      },
      actor.request,
    );
  }

  async integrationHealth(): Promise<IntegrationHealth[]> {
    const { rows } = await this.db.execute<{
      store_id: string;
      store_name: string;
      provider: 'WILDBERRIES' | 'KASPI_XML';
      status: 'ACTIVE' | 'ERROR';
      sync_enabled: boolean;
      last_sync_at: Date | null;
      last_error: string | null;
      linked: string;
      failed: string;
      conflicts: string;
    }>(sql`
      SELECT s.id AS store_id, s.name AS store_name, i.provider, i.status,
             coalesce((i.settings->>'syncEnabled')::boolean, true) AS sync_enabled,
             i.last_sync_at, i.last_error,
             (SELECT count(*) FROM external_listings el WHERE el.integration_id = i.id) AS linked,
             (SELECT count(*) FROM sync_runs r WHERE r.integration_id = i.id AND r.status = 'FAILED' AND r.started_at >= now() - interval '7 days') AS failed,
             (SELECT coalesce(sum(r.conflicts), 0) FROM sync_runs r WHERE r.integration_id = i.id AND r.started_at >= now() - interval '7 days') AS conflicts
      FROM integrations i JOIN stores s ON s.id = i.store_id
      ORDER BY (i.status = 'ERROR') DESC, i.last_sync_at ASC NULLS FIRST
      LIMIT 500`);
    return rows.map((row) => ({
      storeId: row.store_id,
      storeName: row.store_name,
      provider: row.provider,
      status: row.status,
      syncEnabled: row.sync_enabled,
      lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at).toISOString() : null,
      lastError: row.last_error,
      linkedCount: Number(row.linked),
      failedRuns7d: Number(row.failed),
      conflicts7d: Number(row.conflicts),
    }));
  }
}
