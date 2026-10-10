import { randomBytes, randomUUID } from 'node:crypto';
import { eq, inventory, orderItems, orders, sellerOrders, stores } from '@lastsize/db';
import { solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrdersService } from '../src/orders/orders.service';
import { createClient } from './client';
import { cookieHeader, type Harness, startHarness, storageEnabled } from './harness';

const SIZE_EU = (size: number) => 2000 + (size - 19);
const SNEAKERS = 201;
const BLACK = 1;
const tenge = (value: number) => value * 100;

// Every checkout solves a real proof-of-work challenge; CI machines need more time for that.
describe.runIf(storageEnabled)('cart and checkout', { timeout: 30_000 }, () => {
  let h: Harness;
  let c: ReturnType<typeof createClient>;
  let photo: Buffer;

  beforeAll(async () => {
    h = await startHarness();
    c = createClient(h);
    photo = await sharp({
      create: { width: 900, height: 1200, channels: 3, background: { r: 60, g: 60, b: 60 } },
    })
      .jpeg()
      .toBuffer();
  });
  afterAll(async () => {
    await h?.close();
  });

  /** A verified store with one published pair of sneakers: sizes → stock. */
  async function storeWithProduct(stock: Record<number, number>, salePrice = 30000) {
    const seller = await c.register();
    const store = await c.createStoreFor(seller.userId);
    await h.database.db
      .update(stores)
      .set({ status: 'VERIFIED', verifiedAt: new Date(Date.now() - 365 * 86_400_000) })
      .where(eq(stores.id, store.id));
    const boundary = `----ls${randomBytes(6).toString('hex')}`;
    const media = await h.app.inject({
      method: 'POST',
      url: `/api/v1/seller/stores/${store.id}/media`,
      headers: {
        cookie: seller.cookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
        ),
        photo,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    const product = await c.json('POST', `/api/v1/seller/stores/${store.id}/products`, {
      cookie: seller.cookie,
      body: {
        title: 'Кроссовки Air Max',
        brand: 'Nike',
        categoryId: SNEAKERS,
        gender: 'WOMEN',
        colorId: BLACK,
        mediaIds: [media.json().id],
        originalPrice: tenge(60000),
        salePrice: tenge(salePrice),
        variants: Object.entries(stock).map(([size, quantity]) => ({
          sizeValueId: SIZE_EU(Number(size)),
          quantity,
        })),
        publish: true,
      },
    });
    expect(product.statusCode).toBe(201);
    const variants = Object.fromEntries(
      (product.json().variants as { id: string; sizeLabel: string }[]).map((v) => [
        Number(v.sizeLabel),
        v.id,
      ]),
    );
    return { seller, storeId: store.id, productId: product.json().id as string, variants };
  }

  /** A browser of a guest buyer: keeps its device cookie between requests. */
  function buyer() {
    let cookie = '';
    const call = async (
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
      url: string,
      body?: unknown,
      headers?: Record<string, string>,
    ) => {
      const response = await c.json(method, `/api/v1${url}`, { cookie, body, headers });
      const set = cookieHeader(response);
      if (set) cookie = set;
      return response;
    };
    return { call, cookie: () => cookie };
  }

  async function altcha(): Promise<string> {
    const challenge = (await c.json('GET', '/api/v1/orders/challenge')).json();
    const solution = await solveChallenge({ challenge, deriveKey });
    return Buffer.from(JSON.stringify({ challenge, solution })).toString('base64');
  }

  async function checkout(
    b: ReturnType<typeof buyer>,
    fulfillment: unknown[],
    key: string = randomUUID(),
    phone = '+77011234567',
  ) {
    return b.call(
      'POST',
      '/orders',
      { contact: { name: 'Айгерим', phone }, fulfillment, altcha: await altcha() },
      { 'idempotency-key': key },
    );
  }

  async function stockOf(variantId: string) {
    const [row] = await h.database.db
      .select({ quantity: inventory.quantity, reserved: inventory.reserved })
      .from(inventory)
      .where(eq(inventory.variantId, variantId));
    return row!;
  }

  it('keeps a cart per device, within real stock', async () => {
    const shop = await storeWithProduct({ 38: 2, 39: 0 });
    const b = buyer();
    expect((await b.call('GET', '/cart/count')).json()).toEqual({ count: 0 });

    const added = await b.call('POST', '/cart/items', { variantId: shop.variants[38]! });
    expect(added.statusCode).toBe(201);
    expect(b.cookie()).toMatch(/gsid=/);
    await b.call('POST', '/cart/items', { variantId: shop.variants[38]! });
    const tooMany = await b.call('POST', '/cart/items', { variantId: shop.variants[38]! });
    expect(tooMany.json().errors).toEqual([{ path: 'variantId', message: 'stock.notEnough' }]);
    const soldOut = await b.call('POST', '/cart/items', { variantId: shop.variants[39]! });
    expect(soldOut.json().errors).toEqual([{ path: 'variantId', message: 'stock.soldOut' }]);

    const cart = (await b.call('GET', '/cart')).json();
    expect(cart).toMatchObject({ itemCount: 2, itemsTotal: tenge(60000), hasProblems: false });
    expect(cart.stores[0].items[0]).toMatchObject({
      size: '38',
      quantity: 2,
      available: 2,
      unitPrice: tenge(30000),
      discountPercent: 50,
      priceChanged: false,
    });

    // Another device does not see it.
    expect((await buyer().call('GET', '/cart')).json().itemCount).toBe(0);

    await b.call('PATCH', `/cart/items/${shop.variants[38]!}`, { quantity: 1 });
    expect((await b.call('GET', '/cart/count')).json()).toEqual({ count: 1 });
    await b.call('DELETE', `/cart/items/${shop.variants[38]!}`);
    expect((await b.call('GET', '/cart/count')).json()).toEqual({ count: 0 });
  });

  it('places one order split by store, reserving stock and freezing the items', async () => {
    const a = await storeWithProduct({ 38: 3 });
    const z = await storeWithProduct({ 40: 1 }, 25000);
    const b = buyer();
    await b.call('POST', '/cart/items', { variantId: a.variants[38]! });
    await b.call('POST', '/cart/items', { variantId: a.variants[38]! });
    await b.call('POST', '/cart/items', { variantId: z.variants[40]! });

    // Amounts are never taken from the request.
    const tampered = await b.call(
      'POST',
      '/orders',
      {
        contact: { name: 'Айгерим', phone: '+77011234567' },
        fulfillment: [{ storeId: a.storeId, type: 'PICKUP' }],
        altcha: await altcha(),
        itemsTotal: 100,
      },
      { 'idempotency-key': randomUUID() },
    );
    expect(tampered.statusCode).toBe(422);
    const noKey = await b.call('POST', '/orders', {
      contact: { name: 'Айгерим', phone: '+77011234567' },
      fulfillment: [{ storeId: a.storeId, type: 'PICKUP' }],
      altcha: await altcha(),
    });
    expect(noKey.json().errors).toEqual([
      { path: 'idempotencyKey', message: 'idempotencyKey.invalid' },
    ]);
    const noAddress = await checkout(b, [
      { storeId: a.storeId, type: 'PICKUP' },
      { storeId: z.storeId, type: 'DELIVERY' },
    ]);
    expect(noAddress.json().errors).toEqual([
      { path: 'fulfillment.1.address', message: 'address.required' },
    ]);
    const missingStore = await checkout(b, [{ storeId: a.storeId, type: 'PICKUP' }]);
    expect(missingStore.json()).toMatchObject({ status: 409, code: 'CART_CHANGED' });
    const robot = await b.call(
      'POST',
      '/orders',
      {
        contact: { name: 'Айгерим', phone: '+77011234567' },
        fulfillment: [{ storeId: a.storeId, type: 'PICKUP' }],
        altcha: Buffer.from('{"challenge":{},"solution":{}}').toString('base64'),
      },
      { 'idempotency-key': randomUUID() },
    );
    expect(robot.json().errors).toEqual([{ path: 'altcha', message: 'altcha.invalid' }]);

    const key = randomUUID();
    const placed = await checkout(
      b,
      [
        { storeId: a.storeId, type: 'PICKUP' },
        { storeId: z.storeId, type: 'DELIVERY', address: 'Абая 10, кв 5', comment: 'Домофон 5' },
      ],
      key,
    );
    expect(placed.statusCode).toBe(201);
    const { number, accessToken } = placed.json();
    expect(number).toBeGreaterThanOrEqual(10001);
    expect(accessToken).toMatch(/^[A-Za-z0-9_-]{32}$/);

    // Reserved, not yet sold; the cart is empty.
    expect(await stockOf(a.variants[38]!)).toEqual({ quantity: 3, reserved: 2 });
    expect(await stockOf(z.variants[40]!)).toEqual({ quantity: 1, reserved: 1 });
    expect((await b.call('GET', '/cart/count')).json()).toEqual({ count: 0 });

    // A double click with the same key returns the same order.
    const again = await checkout(b, [{ storeId: a.storeId, type: 'PICKUP' }], key);
    expect(again.json()).toEqual({ number, accessToken: null });
    expect(await h.database.db.select().from(orders).where(eq(orders.number, number))).toHaveLength(
      1,
    );

    const detail = (await b.call('GET', `/orders/${number}`)).json();
    expect(detail).toMatchObject({
      number,
      status: 'AWAITING_CONFIRMATION',
      itemsTotal: tenge(85000),
      contactName: 'Айгерим',
    });
    const [pickup, delivery] = [...detail.parts]
      .sort((x, y) => x.fulfillment.localeCompare(y.fulfillment))
      .reverse();
    expect(pickup).toMatchObject({
      fulfillment: 'PICKUP',
      status: 'NEW',
      itemsTotal: tenge(60000),
      canCancel: true,
      deliveryAddress: null,
    });
    expect(pickup.pickupCode).toMatch(/^\d{4}$/);
    expect(pickup.items).toEqual([
      expect.objectContaining({
        title: 'Кроссовки Air Max',
        size: '38',
        quantity: 2,
        unitPrice: tenge(30000),
      }),
    ]);
    expect(delivery).toMatchObject({
      fulfillment: 'DELIVERY',
      pickupCode: null,
      deliveryAddress: 'Абая 10, кв 5',
      deliveryComment: 'Домофон 5',
    });

    // Items are frozen: no code path can change them.
    await expect(h.database.db.update(orderItems).set({ quantity: 99 })).rejects.toThrow();

    // Each store sees only its own part.
    const listA = await c.json('GET', `/api/v1/seller/stores/${a.storeId}/orders`, {
      cookie: a.seller.cookie,
    });
    expect(listA.json()).toMatchObject({ total: 1, counts: { NEW: 1 } });
    expect(listA.json().items[0]).toMatchObject({
      number,
      itemCount: 2,
      contactPhone: '+77011234567',
    });
    const foreign = await c.json(
      'GET',
      `/api/v1/seller/stores/${a.storeId}/orders/${delivery.id}`,
      { cookie: a.seller.cookie },
    );
    expect(foreign.statusCode).toBe(404);
    const own = await c.json('GET', `/api/v1/seller/stores/${z.storeId}/orders/${delivery.id}`, {
      cookie: z.seller.cookie,
    });
    expect(own.json()).toMatchObject({ number, deliveryAddress: 'Абая 10, кв 5', status: 'NEW' });
    expect(own.json().history).toEqual([
      expect.objectContaining({ status: 'NEW', by: 'CUSTOMER' }),
    ]);

    // Another device: only with the order link.
    const stranger = buyer();
    expect((await stranger.call('GET', `/orders/${number}`)).statusCode).toBe(404);
    expect((await stranger.call('GET', `/orders/${number}?t=${'x'.repeat(32)}`)).statusCode).toBe(
      404,
    );
    const shared = await stranger.call('GET', `/orders/${number}?t=${accessToken}`);
    expect(shared.json().number).toBe(number);
    expect((await stranger.call('GET', '/orders')).json()).toEqual([]);
    expect((await b.call('GET', '/orders')).json()).toEqual([
      expect.objectContaining({ number, itemCount: 3, storeNames: expect.any(Array) }),
    ]);

    // The buyer cancels the pickup part: its reservation is released, the other part goes on.
    const cancelled = await b.call('POST', `/orders/${number}/parts/${pickup.id}/cancel`);
    expect(cancelled.statusCode).toBe(200);
    expect(await stockOf(a.variants[38]!)).toEqual({ quantity: 3, reserved: 0 });
    expect(cancelled.json().parts.find((p: { id: string }) => p.id === pickup.id)).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'customer.cancelled',
      canCancel: false,
      pickupCode: null,
    });
    expect((await b.call('POST', `/orders/${number}/parts/${pickup.id}/cancel`)).statusCode).toBe(
      409,
    );
  });

  it('sells the last pair once when several buyers check out at the same time', async () => {
    const shop = await storeWithProduct({ 41: 1 });
    const buyers = Array.from({ length: 5 }, () => buyer());
    for (const b of buyers) await b.call('POST', '/cart/items', { variantId: shop.variants[41]! });
    const results = await Promise.all(
      buyers.map((b, index) =>
        checkout(
          b,
          [{ storeId: shop.storeId, type: 'PICKUP' }],
          randomUUID(),
          `+7701555000${index}`,
        ),
      ),
    );
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409, 409, 409, 409]);
    for (const failed of results.filter((r) => r.statusCode === 409))
      expect(['OUT_OF_STOCK', 'CART_CHANGED']).toContain(failed.json().code);
    expect(await stockOf(shop.variants[41]!)).toEqual({ quantity: 1, reserved: 1 });
  });

  it('asks to confirm new prices before ordering', async () => {
    const shop = await storeWithProduct({ 42: 2 });
    const b = buyer();
    await b.call('POST', '/cart/items', { variantId: shop.variants[42]! });
    const cheaper = await c.json(
      'PATCH',
      `/api/v1/seller/stores/${shop.storeId}/products/${shop.productId}`,
      {
        cookie: shop.seller.cookie,
        body: { salePrice: tenge(19990) },
      },
    );
    expect(cheaper.json()).toMatchObject({ salePrice: tenge(19990) });
    const cart = (await b.call('GET', '/cart')).json();
    expect(cart.stores[0].items[0]).toMatchObject({
      priceChanged: true,
      previousPrice: tenge(30000),
      unitPrice: tenge(19990),
    });
    const first = await checkout(b, [{ storeId: shop.storeId, type: 'PICKUP' }]);
    expect(first.json()).toMatchObject({ code: 'PRICE_CHANGED' });
    const second = await checkout(b, [{ storeId: shop.storeId, type: 'PICKUP' }]);
    expect(second.statusCode).toBe(201);
    const detail = (await b.call('GET', `/orders/${second.json().number}`)).json();
    expect(detail.itemsTotal).toBe(tenge(19990));
  });

  it('limits unconfirmed orders and cancels the ones stores never confirm', async () => {
    const shop = await storeWithProduct({ 43: 5 });
    const b = buyer();
    const phone = '+77017770011';
    for (let i = 0; i < 2; i++) {
      await b.call('POST', '/cart/items', { variantId: shop.variants[43]! });
      expect(
        (await checkout(b, [{ storeId: shop.storeId, type: 'PICKUP' }], randomUUID(), phone))
          .statusCode,
      ).toBe(201);
    }
    await b.call('POST', '/cart/items', { variantId: shop.variants[43]! });
    const third = await checkout(
      b,
      [{ storeId: shop.storeId, type: 'PICKUP' }],
      randomUUID(),
      phone,
    );
    expect(third.json().errors).toEqual([{ path: 'form', message: 'orders.tooManyPending' }]);
    // Same phone from another device: still limited.
    const other = buyer();
    await other.call('POST', '/cart/items', { variantId: shop.variants[43]! });
    const sameNumber = await checkout(
      other,
      [{ storeId: shop.storeId, type: 'PICKUP' }],
      randomUUID(),
      phone,
    );
    expect(sameNumber.json().errors).toEqual([{ path: 'form', message: 'orders.tooManyPending' }]);
    expect(await stockOf(shop.variants[43]!)).toEqual({ quantity: 5, reserved: 2 });

    // The store never answers: after 24 h both are cancelled and the stock is free again.
    await h.database.db
      .update(sellerOrders)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sellerOrders.storeId, shop.storeId));
    expect(await h.app.get(OrdersService).expireUnconfirmed()).toBe(2);
    expect(await stockOf(shop.variants[43]!)).toEqual({ quantity: 5, reserved: 0 });
    const list = (await b.call('GET', '/orders')).json();
    expect(list.map((o: { status: string }) => o.status)).toEqual(['CANCELLED', 'CANCELLED']);
    const [part] = await h.database.db
      .select({ reason: sellerOrders.cancelReason })
      .from(sellerOrders)
      .where(eq(sellerOrders.storeId, shop.storeId))
      .limit(1);
    expect(part!.reason).toBe('system.notConfirmed');
    expect(
      (await checkout(b, [{ storeId: shop.storeId, type: 'PICKUP' }], randomUUID(), phone))
        .statusCode,
    ).toBe(201);
  });

  it('refuses a solved challenge used twice', async () => {
    const shop = await storeWithProduct({ 44: 3 });
    const b = buyer();
    await b.call('POST', '/cart/items', { variantId: shop.variants[44]! });
    const payload = await altcha();
    const body = {
      contact: { name: 'Айгерим', phone: '+77019990001' },
      fulfillment: [{ storeId: shop.storeId, type: 'PICKUP' }],
      altcha: payload,
    };
    expect(
      (await b.call('POST', '/orders', body, { 'idempotency-key': randomUUID() })).statusCode,
    ).toBe(201);
    await b.call('POST', '/cart/items', { variantId: shop.variants[44]! });
    const replay = await b.call('POST', '/orders', body, { 'idempotency-key': randomUUID() });
    expect(replay.json().errors).toEqual([{ path: 'altcha', message: 'altcha.invalid' }]);
  });
});
