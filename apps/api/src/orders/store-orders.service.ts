import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ReturnRequest, StoreActionRequest } from '@lastsize/contracts';
import {
  and,
  type Database,
  eq,
  inArray,
  orderItems,
  returnItems,
  returnStock,
  sellerOrders,
  sql,
  storeLocations,
} from '@lastsize/db';
import { canAcceptReturn, PICKUP_WINDOW_HOURS, storeActions } from '@lastsize/domain';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { DATABASE } from '../infrastructure/infrastructure.module';
import { RateLimiterService } from '../security/rate-limiter.service';
import { ValidationFailedException } from '../security/zod-validation.pipe';
import { SyncScheduler } from '../sync/sync-queue';
import { OrderSecrets } from './order-secrets';
import { applySellerOrderTransition } from './seller-order-transitions';

type Actor = { userId: string; request: FastifyRequest };

/** 10 000 codes: a few tries per order per hour keep guessing pointless. */
const PICKUP_CODE_ATTEMPTS = { name: 'pickup:code', limit: 5, windowSeconds: 60 * 60 };

/**
 * What a store does with its part of an order: confirm, prepare, bill and hand over, cancel
 * with a reason, and take goods back within 14 days. Every step is checked against the
 * domain's rules on the server, whatever the page shows.
 */
@Injectable()
export class StoreOrdersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly secrets: OrderSecrets,
    private readonly rateLimiter: RateLimiterService,
    private readonly syncScheduler: SyncScheduler,
    private readonly audit: AuditService,
  ) {}

  async act(
    storeId: string,
    sellerOrderId: string,
    body: StoreActionRequest,
    actor: Actor,
  ): Promise<void> {
    const part = await this.part(storeId, sellerOrderId);
    if (!storeActions(part).includes(body.action)) {
      if (body.action === 'requestCourier' && part.paymentStatus !== 'PAID_TO_SELLER')
        throw new ValidationFailedException([{ path: 'action', message: 'order.notPaid' }]);
      throw new ConflictException('Это действие недоступно для заказа в текущем статусе');
    }
    if (body.action === 'complete' && part.fulfillment === 'PICKUP') {
      await this.rateLimiter.consume(PICKUP_CODE_ATTEMPTS, sellerOrderId);
      if (body.pickupCode !== this.secrets.pickupCode(sellerOrderId))
        throw new ValidationFailedException([
          { path: 'pickupCode', message: 'pickupCode.invalid' },
        ]);
    }

    const actorRef = { type: 'STORE' as const, id: actor.userId };
    await this.db.transaction(async (tx) => {
      if (body.action === 'markPaid') {
        // Only from the state the page saw: a concurrent change makes this a no-op conflict.
        const [updated] = await tx
          .update(sellerOrders)
          .set({ paymentStatus: 'PAID_TO_SELLER' })
          .where(
            and(
              eq(sellerOrders.id, sellerOrderId),
              eq(sellerOrders.status, 'CONFIRMED'),
              eq(sellerOrders.paymentStatus, 'UNPAID'),
            ),
          )
          .returning({ id: sellerOrders.id });
        if (!updated) throw new ConflictException('Заказ только что изменился. Обновите страницу.');
        return;
      }
      const reason = body.action === 'cancel' ? body.reason : undefined;
      await applySellerOrderTransition(tx, sellerOrderId, body.action, actorRef, reason);
      if (body.action === 'readyForPickup') {
        await tx
          .update(sellerOrders)
          .set({ expiresAt: sql`now() + make_interval(hours => ${PICKUP_WINDOW_HOURS})` })
          .where(eq(sellerOrders.id, sellerOrderId));
      }
      if (body.action === 'requestCourier') {
        await tx
          .update(sellerOrders)
          .set({ courierFee: body.courierFee, courierTrackingUrl: body.trackingUrl ?? null })
          .where(eq(sellerOrders.id, sellerOrderId));
      }
      if (body.action === 'complete') {
        // Pickup orders are paid at the counter.
        await tx
          .update(sellerOrders)
          .set({ completedAt: sql`now()`, paymentStatus: 'PAID_TO_SELLER' })
          .where(eq(sellerOrders.id, sellerOrderId));
      }
    });

    await this.syncScheduler.storeStockChanged(storeId);
    await this.audit.record(
      {
        action: `seller_order.${body.action}`,
        actorType: 'USER',
        actorId: actor.userId,
        entityType: 'seller_order',
        entityId: sellerOrderId,
        metadata:
          body.action === 'cancel'
            ? { reason: body.reason }
            : body.action === 'requestCourier'
              ? { courierFee: body.courierFee }
              : undefined,
      },
      actor.request,
    );
  }

  /**
   * The buyer brought goods back. Accepted units go back on sale (RETURN in the stock ledger);
   * a refusal needs a reason the buyer will see.
   */
  async processReturn(
    storeId: string,
    sellerOrderId: string,
    body: ReturnRequest,
    actor: Actor,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [part] = await tx
        .select({ status: sellerOrders.status, completedAt: sellerOrders.completedAt })
        .from(sellerOrders)
        .where(and(eq(sellerOrders.id, sellerOrderId), eq(sellerOrders.storeId, storeId)))
        .for('update');
      if (!part) throw new NotFoundException('Заказ не найден');
      if (part.status !== 'COMPLETED' || !canAcceptReturn(part.completedAt))
        throw new ValidationFailedException([{ path: 'items', message: 'return.expired' }]);

      const ids = body.items.map((item) => item.orderItemId);
      if (new Set(ids).size !== ids.length)
        throw new ValidationFailedException([{ path: 'items', message: 'return.duplicate' }]);
      const bought = await tx
        .select({
          id: orderItems.id,
          variantId: orderItems.variantId,
          quantity: orderItems.quantity,
          returned: sql<number>`coalesce((SELECT sum(r.quantity) FROM return_items r WHERE r.order_item_id = order_items.id AND r.status = 'ACCEPTED'), 0)::int`,
        })
        .from(orderItems)
        .where(and(eq(orderItems.sellerOrderId, sellerOrderId), inArray(orderItems.id, ids)));
      if (bought.length !== ids.length)
        throw new ValidationFailedException([{ path: 'items', message: 'return.unknownItem' }]);
      for (const item of body.items) {
        const line = bought.find((row) => row.id === item.orderItemId)!;
        if (item.quantity > line.quantity - line.returned)
          throw new ValidationFailedException([
            { path: `items.${item.orderItemId}`, message: 'return.tooMany' },
          ]);
      }

      const accepted = body.decision === 'accept';
      await tx.insert(returnItems).values(
        body.items.map((item) => ({
          orderItemId: item.orderItemId,
          quantity: item.quantity,
          status: accepted ? ('ACCEPTED' as const) : ('REJECTED' as const),
          reason: accepted ? (body.reason ?? null) : body.reason!,
          refundMethod: accepted ? body.refundMethod! : null,
          processedBy: actor.userId,
        })),
      );
      if (accepted) {
        const [location] = await tx
          .select({ id: storeLocations.id })
          .from(storeLocations)
          .where(eq(storeLocations.storeId, storeId));
        await returnStock(
          tx,
          body.items.map((item) => ({
            variantId: bought.find((row) => row.id === item.orderItemId)!.variantId,
            locationId: location!.id,
            quantity: item.quantity,
          })),
          { refType: 'seller_order', refId: sellerOrderId, actorUserId: actor.userId },
        );
      }
    });

    if (body.decision === 'accept') await this.syncScheduler.storeStockChanged(storeId);
    await this.audit.record(
      {
        action: body.decision === 'accept' ? 'return.accepted' : 'return.rejected',
        actorType: 'USER',
        actorId: actor.userId,
        entityType: 'seller_order',
        entityId: sellerOrderId,
        metadata: { items: body.items.length },
      },
      actor.request,
    );
  }

  private async part(storeId: string, sellerOrderId: string) {
    const [part] = await this.db
      .select({
        status: sellerOrders.status,
        fulfillment: sellerOrders.fulfillment,
        paymentStatus: sellerOrders.paymentStatus,
      })
      .from(sellerOrders)
      .where(and(eq(sellerOrders.id, sellerOrderId), eq(sellerOrders.storeId, storeId)));
    if (!part) throw new NotFoundException('Заказ не найден');
    return part;
  }
}
