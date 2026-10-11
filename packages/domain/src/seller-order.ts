/**
 * Lifecycle of the part of an order one store fulfils. Every status change goes through
 * `transitionSellerOrder`, so who may do what, and when, is defined in one place.
 */

export type SellerOrderStatus =
  | 'NEW'
  | 'CONFIRMED'
  | 'READY_FOR_PICKUP'
  | 'COURIER_REQUESTED'
  | 'HANDED_TO_COURIER'
  | 'COMPLETED'
  | 'CANCELLED';
export type Fulfillment = 'PICKUP' | 'DELIVERY';
export type OrderActor = 'CUSTOMER' | 'STORE' | 'SYSTEM' | 'ADMIN';
export type SellerOrderAction =
  'confirm' | 'readyForPickup' | 'requestCourier' | 'handToCourier' | 'complete' | 'cancel';

/** What happens to reserved stock on a transition. */
export type StockEffect = 'release' | 'commit' | null;

export const FINAL_STATUSES: readonly SellerOrderStatus[] = ['COMPLETED', 'CANCELLED'];

interface Rule {
  from: readonly SellerOrderStatus[];
  to: SellerOrderStatus;
  actors: readonly OrderActor[];
  fulfillment?: Fulfillment;
}

const RULES: Record<Exclude<SellerOrderAction, 'cancel'>, Rule> = {
  confirm: { from: ['NEW'], to: 'CONFIRMED', actors: ['STORE', 'ADMIN'] },
  readyForPickup: {
    from: ['CONFIRMED'],
    to: 'READY_FOR_PICKUP',
    actors: ['STORE', 'ADMIN'],
    fulfillment: 'PICKUP',
  },
  requestCourier: {
    from: ['CONFIRMED'],
    to: 'COURIER_REQUESTED',
    actors: ['STORE', 'ADMIN'],
    fulfillment: 'DELIVERY',
  },
  handToCourier: {
    from: ['COURIER_REQUESTED'],
    to: 'HANDED_TO_COURIER',
    actors: ['STORE', 'ADMIN'],
    fulfillment: 'DELIVERY',
  },
  complete: {
    from: ['READY_FOR_PICKUP', 'HANDED_TO_COURIER'],
    to: 'COMPLETED',
    actors: ['STORE', 'ADMIN'],
  },
};

/** Who may cancel from which status: the buyer only before the store has confirmed. */
const CANCEL_FROM: Record<OrderActor, readonly SellerOrderStatus[]> = {
  CUSTOMER: ['NEW'],
  STORE: ['NEW', 'CONFIRMED', 'READY_FOR_PICKUP', 'COURIER_REQUESTED'],
  // Not confirmed in time, or not picked up in time.
  SYSTEM: ['NEW', 'READY_FOR_PICKUP'],
  ADMIN: ['NEW', 'CONFIRMED', 'READY_FOR_PICKUP', 'COURIER_REQUESTED', 'HANDED_TO_COURIER'],
};

export interface Transition {
  to: SellerOrderStatus;
  stock: StockEffect;
}

/**
 * The next status, or null when the action is not allowed for this actor, status and
 * fulfillment. Stock leaves the shelf when the goods leave the store: on hand-over to a
 * courier or on pickup.
 */
export function transitionSellerOrder(
  action: SellerOrderAction,
  current: { status: SellerOrderStatus; fulfillment: Fulfillment },
  actor: OrderActor,
): Transition | null {
  if (action === 'cancel') {
    if (!CANCEL_FROM[actor].includes(current.status)) return null;
    // Goods handed to a courier are already off our stock; nothing to release.
    return {
      to: 'CANCELLED',
      stock: current.status === 'HANDED_TO_COURIER' ? null : 'release',
    };
  }
  const rule = RULES[action];
  if (!rule.actors.includes(actor) || !rule.from.includes(current.status)) return null;
  if (rule.fulfillment && rule.fulfillment !== current.fulfillment) return null;
  const leavesStore =
    action === 'handToCourier' || (action === 'complete' && current.status === 'READY_FOR_PICKUP');
  return { to: rule.to, stock: leavesStore ? 'commit' : null };
}

export type OrderOverallStatus =
  'AWAITING_CONFIRMATION' | 'IN_PROGRESS' | 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'CANCELLED';

/** What the buyer sees for the whole order, from the statuses of its store parts. */
export function overallOrderStatus(statuses: readonly SellerOrderStatus[]): OrderOverallStatus {
  const open = statuses.filter((status) => !FINAL_STATUSES.includes(status));
  const completed = statuses.filter((status) => status === 'COMPLETED').length;
  if (open.length === 0) {
    if (completed === 0) return 'CANCELLED';
    return completed === statuses.length ? 'COMPLETED' : 'PARTIALLY_COMPLETED';
  }
  return open.every((status) => status === 'NEW') && completed === 0
    ? 'AWAITING_CONFIRMATION'
    : 'IN_PROGRESS';
}

/** A ready pickup order waits this long; then it is cancelled and the goods go back on sale. */
export const PICKUP_WINDOW_HOURS = 48;
/** Buyers can bring goods back to the store within this many days of receiving them. */
export const RETURN_WINDOW_DAYS = 14;

/** Why a store cancels; shown to the buyer as a translated text. */
export const STORE_CANCEL_REASONS = [
  'store.outOfStock',
  'store.customerUnreachable',
  'store.customerRefused',
  'store.other',
] as const;
export type StoreCancelReason = (typeof STORE_CANCEL_REASONS)[number];

export type PaymentStatus = 'UNPAID' | 'PAID_TO_SELLER';
export type StoreAction = SellerOrderAction | 'markPaid';

export function returnDeadline(completedAt: Date): Date {
  return new Date(completedAt.getTime() + RETURN_WINDOW_DAYS * 86_400_000);
}

export function canAcceptReturn(completedAt: Date | null, now = new Date()): boolean {
  return completedAt !== null && now < returnDeadline(completedAt);
}

/**
 * Delivery: the store bills the buyer (goods + courier, Kaspi Pay), marks the order paid and
 * only then calls a courier. Pickup orders are paid at the counter.
 */
export function storeActions(current: {
  status: SellerOrderStatus;
  fulfillment: Fulfillment;
  paymentStatus: PaymentStatus;
}): StoreAction[] {
  const actions: StoreAction[] = [];
  for (const action of [
    'confirm',
    'readyForPickup',
    'requestCourier',
    'handToCourier',
    'complete',
    'cancel',
  ] as const) {
    if (!transitionSellerOrder(action, current, 'STORE')) continue;
    if (action === 'requestCourier' && current.paymentStatus !== 'PAID_TO_SELLER') continue;
    actions.push(action);
  }
  if (
    current.fulfillment === 'DELIVERY' &&
    current.status === 'CONFIRMED' &&
    current.paymentStatus === 'UNPAID'
  )
    actions.push('markPaid');
  return actions;
}
