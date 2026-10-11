import { describe, expect, it } from 'vitest';
import {
  canAcceptReturn,
  overallOrderStatus,
  returnDeadline,
  storeActions,
  transitionSellerOrder,
} from './seller-order.js';

const pickup = (status: Parameters<typeof transitionSellerOrder>[1]['status']) => ({
  status,
  fulfillment: 'PICKUP' as const,
});
const delivery = (status: Parameters<typeof transitionSellerOrder>[1]['status']) => ({
  status,
  fulfillment: 'DELIVERY' as const,
});

describe('transitionSellerOrder', () => {
  it('walks a pickup order to completion, taking stock off the shelf at pickup', () => {
    expect(transitionSellerOrder('confirm', pickup('NEW'), 'STORE')).toEqual({
      to: 'CONFIRMED',
      stock: null,
    });
    expect(transitionSellerOrder('readyForPickup', pickup('CONFIRMED'), 'STORE')).toEqual({
      to: 'READY_FOR_PICKUP',
      stock: null,
    });
    expect(transitionSellerOrder('complete', pickup('READY_FOR_PICKUP'), 'STORE')).toEqual({
      to: 'COMPLETED',
      stock: 'commit',
    });
  });

  it('walks a delivery order, taking stock off when the courier collects it', () => {
    expect(transitionSellerOrder('requestCourier', delivery('CONFIRMED'), 'STORE')?.to).toBe(
      'COURIER_REQUESTED',
    );
    expect(transitionSellerOrder('handToCourier', delivery('COURIER_REQUESTED'), 'STORE')).toEqual({
      to: 'HANDED_TO_COURIER',
      stock: 'commit',
    });
    expect(transitionSellerOrder('complete', delivery('HANDED_TO_COURIER'), 'STORE')).toEqual({
      to: 'COMPLETED',
      stock: null,
    });
  });

  it('refuses steps that do not fit the fulfillment, the status or the actor', () => {
    expect(transitionSellerOrder('readyForPickup', delivery('CONFIRMED'), 'STORE')).toBeNull();
    expect(transitionSellerOrder('requestCourier', pickup('CONFIRMED'), 'STORE')).toBeNull();
    expect(transitionSellerOrder('complete', pickup('NEW'), 'STORE')).toBeNull();
    expect(transitionSellerOrder('confirm', pickup('NEW'), 'CUSTOMER')).toBeNull();
    expect(transitionSellerOrder('confirm', pickup('CANCELLED'), 'ADMIN')).toBeNull();
  });

  it('lets the buyer cancel only before confirmation, and releases the reservation', () => {
    expect(transitionSellerOrder('cancel', pickup('NEW'), 'CUSTOMER')).toEqual({
      to: 'CANCELLED',
      stock: 'release',
    });
    expect(transitionSellerOrder('cancel', pickup('CONFIRMED'), 'CUSTOMER')).toBeNull();
    expect(transitionSellerOrder('cancel', pickup('CONFIRMED'), 'STORE')?.to).toBe('CANCELLED');
    expect(transitionSellerOrder('cancel', pickup('CONFIRMED'), 'SYSTEM')).toBeNull();
    expect(transitionSellerOrder('cancel', pickup('COMPLETED'), 'ADMIN')).toBeNull();
    expect(transitionSellerOrder('cancel', delivery('HANDED_TO_COURIER'), 'ADMIN')).toEqual({
      to: 'CANCELLED',
      stock: null,
    });
  });
});

describe('overallOrderStatus', () => {
  it.each([
    [['NEW', 'NEW'], 'AWAITING_CONFIRMATION'],
    [['NEW', 'CONFIRMED'], 'IN_PROGRESS'],
    [['NEW', 'CANCELLED'], 'AWAITING_CONFIRMATION'],
    [['COMPLETED', 'NEW'], 'IN_PROGRESS'],
    [['COMPLETED', 'COMPLETED'], 'COMPLETED'],
    [['COMPLETED', 'CANCELLED'], 'PARTIALLY_COMPLETED'],
    [['CANCELLED', 'CANCELLED'], 'CANCELLED'],
  ] as const)('%j → %s', (statuses, expected) => {
    expect(overallOrderStatus(statuses)).toBe(expected);
  });
});

describe('storeActions', () => {
  it('asks for payment before a courier is called', () => {
    expect(
      storeActions({ status: 'CONFIRMED', fulfillment: 'DELIVERY', paymentStatus: 'UNPAID' }),
    ).toEqual(['cancel', 'markPaid']);
    expect(
      storeActions({
        status: 'CONFIRMED',
        fulfillment: 'DELIVERY',
        paymentStatus: 'PAID_TO_SELLER',
      }),
    ).toEqual(['requestCourier', 'cancel']);
  });

  it('offers the next pickup step', () => {
    expect(storeActions({ status: 'NEW', fulfillment: 'PICKUP', paymentStatus: 'UNPAID' })).toEqual(
      ['confirm', 'cancel'],
    );
    expect(
      storeActions({ status: 'READY_FOR_PICKUP', fulfillment: 'PICKUP', paymentStatus: 'UNPAID' }),
    ).toEqual(['complete', 'cancel']);
    expect(
      storeActions({ status: 'COMPLETED', fulfillment: 'PICKUP', paymentStatus: 'PAID_TO_SELLER' }),
    ).toEqual([]);
  });
});

describe('returns window', () => {
  it('accepts returns for 14 days after completion', () => {
    const completed = new Date('2026-10-01T10:00:00Z');
    expect(returnDeadline(completed).toISOString()).toBe('2026-10-15T10:00:00.000Z');
    expect(canAcceptReturn(completed, new Date('2026-10-15T09:59:00Z'))).toBe(true);
    expect(canAcceptReturn(completed, new Date('2026-10-15T10:00:00Z'))).toBe(false);
    expect(canAcceptReturn(null)).toBe(false);
  });
});
