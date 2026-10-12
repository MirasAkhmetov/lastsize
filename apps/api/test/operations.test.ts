import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from './client';
import { type Harness, startHarness, storageEnabled } from './harness';
import { shopHelpers, tenge } from './shop';

describe.runIf(storageEnabled)('platform operations', { timeout: 60_000 }, () => {
  let h: Harness;
  let c: ReturnType<typeof createClient>;
  let shop: Awaited<ReturnType<typeof shopHelpers>>;
  let admin: Awaited<ReturnType<ReturnType<typeof createClient>['makeVerifiedStaff']>>;

  beforeAll(async () => {
    h = await startHarness();
    c = createClient(h);
    shop = await shopHelpers(h, c);
    admin = await c.makeVerifiedStaff('ADMIN');
  });
  afterAll(async () => {
    await h?.close();
  });

  let phoneCounter = 0;
  const nextPhone = () =>
    `+7703${String(Date.now()).slice(-5)}${String(++phoneCounter).padStart(2, '0')}`;

  /** One placed order in `store` by a fresh buyer; returns the store part id and number. */
  async function order(
    store: Awaited<ReturnType<typeof shop.storeWithProduct>>,
    size: number,
    phone = nextPhone(),
  ) {
    const b = shop.buyer();
    await b.call('POST', '/cart/items', { variantId: store.variants[size]! });
    const placed = await shop.checkout(
      b,
      [{ storeId: store.storeId, type: 'PICKUP' }],
      randomUUID(),
      phone,
    );
    expect(placed.statusCode).toBe(201);
    const number = placed.json().number as number;
    const part = (await b.call('GET', `/orders/${number}`)).json().parts[0];
    const act = (body: unknown) =>
      c.json('POST', `/api/v1/seller/stores/${store.storeId}/orders/${part.id}/actions`, {
        cookie: store.seller.cookie,
        body,
      });
    return {
      b,
      number,
      partId: part.id as string,
      pickupCode: part.pickupCode as string,
      act,
      phone,
    };
  }

  const adminGet = (url: string) => c.json('GET', `/api/v1/admin${url}`, { cookie: admin.cookie });

  it('counts sales, cancellations, returns and confirmation time for a store and the platform', async () => {
    const store = await shop.storeWithProduct({ 40: 10 });
    const sold = await order(store, 40);
    await sold.act({ action: 'confirm' });
    await sold.act({ action: 'readyForPickup' });
    const done = await sold.act({ action: 'complete', pickupCode: sold.pickupCode });
    await c.json('POST', `/api/v1/seller/stores/${store.storeId}/orders/${sold.partId}/returns`, {
      cookie: store.seller.cookie,
      body: {
        items: [{ orderItemId: done.json().items[0].id, quantity: 1 }],
        decision: 'accept',
        refundMethod: 'CASH',
      },
    });
    const second = await order(store, 40);
    await second.act({ action: 'confirm' });
    await second.act({ action: 'readyForPickup' });
    await second.act({ action: 'complete', pickupCode: second.pickupCode });
    const missing = await order(store, 40);
    await missing.act({ action: 'cancel', reason: 'store.outOfStock' });

    const stats = await c.json('GET', `/api/v1/seller/stores/${store.storeId}/analytics?days=30`, {
      cookie: store.seller.cookie,
    });
    expect(stats.json()).toMatchObject({
      days: 30,
      orders: 3,
      completed: 2,
      cancelled: 1,
      cancelRate: 0.333,
      revenue: tenge(30000),
      returnsAccepted: 1,
      medianConfirmMinutes: 0,
      topProducts: [{ title: 'Кроссовки Air Max', units: 2, revenue: tenge(60000) }],
    });
    // Another store cannot read these numbers.
    const other = await shop.storeWithProduct({ 41: 1 });
    expect(
      (
        await c.json('GET', `/api/v1/seller/stores/${store.storeId}/analytics`, {
          cookie: other.seller.cookie,
        })
      ).statusCode,
    ).toBe(404);

    const platform = (await adminGet('/analytics?days=30')).json();
    expect(platform.completed).toBeGreaterThanOrEqual(2);
    expect(platform.outOfStockRate).toBeGreaterThan(0);
    expect(platform.activeStores).toBeGreaterThanOrEqual(2);
    expect(platform.weekly).toHaveLength(8);
    expect(platform.weekly.at(-1).completed).toBeGreaterThanOrEqual(2);
    expect(
      (await c.json('GET', '/api/v1/admin/analytics', { cookie: store.seller.cookie })).statusCode,
    ).toBe(403);
  });

  it('flags stores that cancel too often', async () => {
    const store = await shop.storeWithProduct({ 42: 10 });
    const placed = [];
    for (let i = 0; i < 5; i++) placed.push(await order(store, 42));
    await placed[0]!.act({ action: 'cancel', reason: 'store.outOfStock' });
    await placed[1]!.act({ action: 'cancel', reason: 'store.other' });
    const review = (await adminGet('/analytics')).json().storesToReview;
    expect(review).toContainEqual(
      expect.objectContaining({ storeId: store.storeId, orders: 5, cancelled: 2, cancelRate: 0.4 }),
    );
  });

  it('lets support find and cancel any order', async () => {
    const store = await shop.storeWithProduct({ 43: 2 });
    const placed = await order(store, 43);
    await placed.act({ action: 'confirm' });
    const list = (await adminGet(`/orders?q=${placed.number}`)).json();
    expect(list).toMatchObject({ total: 1 });
    expect(list.items[0]).toMatchObject({
      number: placed.number,
      storeId: store.storeId,
      status: 'CONFIRMED',
    });
    const detail = (await adminGet(`/orders/${placed.partId}`)).json();
    expect(detail).toMatchObject({ canCancel: true, phoneBlocked: false, phoneProblems: 0 });

    const short = await c.json('POST', `/api/v1/admin/orders/${placed.partId}/cancel`, {
      cookie: admin.cookie,
      body: { note: 'x' },
    });
    expect(short.statusCode).toBe(422);
    const cancelled = await c.json('POST', `/api/v1/admin/orders/${placed.partId}/cancel`, {
      cookie: admin.cookie,
      body: { note: 'Покупатель пожаловался: магазин не выходит на связь' },
    });
    expect(cancelled.json()).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'admin.cancelled',
      canCancel: false,
    });
    expect(await shop.stockOf(store.variants[43]!)).toEqual({ quantity: 2, reserved: 0 });
    // Both sides are told.
    const buyerNews = (await placed.b.call('GET', '/customer/notifications')).json().items;
    expect(buyerNews[0]).toMatchObject({ type: 'order.cancelledForCustomer' });
    expect(buyerNews[0].body).toContain('поддержка LastSize');
    const storeNews = (
      await c.json('GET', `/api/v1/seller/stores/${store.storeId}/notifications`, {
        cookie: store.seller.cookie,
      })
    ).json().items;
    expect(storeNews[0]).toMatchObject({ type: 'order.cancelledForStore' });

    // A seller cannot use support tools.
    expect(
      (
        await c.json('POST', `/api/v1/admin/orders/${placed.partId}/cancel`, {
          cookie: store.seller.cookie,
          body: { note: 'попытка' },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('puts numbers behind fake orders on a list, and blocked numbers cannot order', async () => {
    const store = await shop.storeWithProduct({ 44: 10 });
    const phone = nextPhone();
    for (let i = 0; i < 3; i++) {
      const placed = await order(store, 44, phone);
      await placed.act({ action: 'cancel', reason: 'store.customerUnreachable' });
    }
    const suspicious = (await adminGet('/phones/suspicious')).json();
    expect(suspicious).toContainEqual(
      expect.objectContaining({ phone, orders: 3, unreachable: 3, blocked: false }),
    );

    const blocked = await c.json('POST', '/api/v1/admin/phones/blocked', {
      cookie: admin.cookie,
      body: { phone, reason: 'Три заказа без ответа' },
    });
    expect(blocked.statusCode).toBe(204);
    expect((await adminGet('/phones/blocked')).json()).toContainEqual(
      expect.objectContaining({ phone, reason: 'Три заказа без ответа' }),
    );
    const b = shop.buyer();
    await b.call('POST', '/cart/items', { variantId: store.variants[44]! });
    const refused = await shop.checkout(
      b,
      [{ storeId: store.storeId, type: 'PICKUP' }],
      randomUUID(),
      phone,
    );
    expect(refused.json().errors).toEqual([{ path: 'contact.phone', message: 'phone.blocked' }]);

    expect(
      (
        await c.json('DELETE', `/api/v1/admin/phones/blocked/${encodeURIComponent(phone)}`, {
          cookie: admin.cookie,
        })
      ).statusCode,
    ).toBe(204);
    const allowed = await shop.checkout(
      b,
      [{ storeId: store.storeId, type: 'PICKUP' }],
      randomUUID(),
      phone,
    );
    expect(allowed.statusCode).toBe(201);
    expect(
      (await c.json('GET', '/api/v1/admin/phones/suspicious', { cookie: store.seller.cookie }))
        .statusCode,
    ).toBe(403);
  });

  it('shows the health of marketplace syncs', async () => {
    const health = await adminGet('/integrations');
    expect(health.statusCode).toBe(200);
    expect(Array.isArray(health.json())).toBe(true);
  });
});
