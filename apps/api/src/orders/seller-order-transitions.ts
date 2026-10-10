import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  commitStock,
  eq,
  orderItems,
  releaseStock,
  sellerOrders,
  sellerOrderStatusHistory,
  sql,
  storeLocations,
  type Transaction,
} from '@lastsize/db';
import {
  type OrderActor,
  type SellerOrderAction,
  type SellerOrderStatus,
  transitionSellerOrder,
} from '@lastsize/domain';

const ACTOR_TYPE: Record<OrderActor, 'USER' | 'CUSTOMER' | 'SYSTEM'> = {
  CUSTOMER: 'CUSTOMER',
  STORE: 'USER',
  ADMIN: 'USER',
  SYSTEM: 'SYSTEM',
};

export interface TransitionResult {
  storeId: string;
  from: SellerOrderStatus;
  to: SellerOrderStatus;
}

/**
 * The one way a seller order changes status: row lock, the domain's transition table, the
 * stock movement it implies, and a history row, all in the caller's transaction.
 */
export async function applySellerOrderTransition(
  tx: Transaction,
  sellerOrderId: string,
  action: SellerOrderAction,
  actor: { type: OrderActor; id: string | null },
  reason?: string,
): Promise<TransitionResult> {
  const [current] = await tx
    .select({
      status: sellerOrders.status,
      fulfillment: sellerOrders.fulfillment,
      storeId: sellerOrders.storeId,
    })
    .from(sellerOrders)
    .where(eq(sellerOrders.id, sellerOrderId))
    .for('update');
  if (!current) throw new NotFoundException('Заказ не найден');
  const transition = transitionSellerOrder(action, current, actor.type);
  if (!transition)
    throw new ConflictException('Это действие недоступно для заказа в текущем статусе');

  if (transition.stock) {
    const [location] = await tx
      .select({ id: storeLocations.id })
      .from(storeLocations)
      .where(eq(storeLocations.storeId, current.storeId));
    const items = await tx
      .select({ variantId: orderItems.variantId, quantity: orderItems.quantity })
      .from(orderItems)
      .where(eq(orderItems.sellerOrderId, sellerOrderId));
    const lines = items.map((item) => ({ ...item, locationId: location!.id }));
    const ref = {
      refType: 'seller_order',
      refId: sellerOrderId,
      actorUserId: ACTOR_TYPE[actor.type] === 'USER' ? actor.id : null,
    };
    if (transition.stock === 'release') await releaseStock(tx, lines, ref);
    else await commitStock(tx, lines, ref);
  }

  await tx
    .update(sellerOrders)
    .set({
      status: transition.to,
      ...(transition.to === 'CANCELLED' ? { cancelReason: reason ?? null } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(sellerOrders.id, sellerOrderId));
  await tx.insert(sellerOrderStatusHistory).values({
    sellerOrderId,
    fromStatus: current.status,
    toStatus: transition.to,
    actorType: ACTOR_TYPE[actor.type],
    actorId: actor.id,
    reason: reason ?? null,
  });
  return { storeId: current.storeId, from: current.status, to: transition.to };
}
