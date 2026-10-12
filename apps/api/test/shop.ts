import { randomBytes, randomUUID } from 'node:crypto';
import { eq, inventory, stores } from '@lastsize/db';
import { solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import sharp from 'sharp';
import { expect } from 'vitest';
import type { createClient } from './client';
import { cookieHeader, type Harness } from './harness';

export const SIZE_EU = (size: number) => 2000 + (size - 19);
export const SNEAKERS = 201;
export const BLACK = 1;
export const tenge = (value: number) => value * 100;

/** Verified stores with products, guest buyers with their own cookies, and checkout. */
export async function shopHelpers(h: Harness, c: ReturnType<typeof createClient>) {
  const photo = await sharp({
    create: { width: 900, height: 1200, channels: 3, background: { r: 60, g: 60, b: 60 } },
  })
    .jpeg()
    .toBuffer();

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

  return { storeWithProduct, buyer, altcha, checkout, stockOf };
}
