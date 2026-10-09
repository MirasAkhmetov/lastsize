import { randomBytes } from 'node:crypto';
import {
  eq,
  inventory,
  priceHistory,
  products,
  productVariants,
  reserveStock,
  storeMedia,
  stores,
} from '@lastsize/db';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from './client';
import { type Harness, startHarness, storageEnabled } from './harness';

const SIZE_EU = (size: number) => 2000 + (size - 19); // SHOES_EU ids: 2001 = EU 20
const SIZE_S = 1002;
const KIDS_110 = 3007;
const SNEAKERS = 201;
const DRESSES = 101;
const BAGS = 301;
const BLACK = 1;
const tenge = (value: number) => value * 100;

async function jpeg(width = 900, height = 1200) {
  return sharp({ create: { width, height, channels: 3, background: { r: 30, g: 30, b: 30 } } })
    .jpeg()
    .toBuffer();
}

function multipart(buffer: Buffer, filename = 'photo.jpg', contentType = 'image/jpeg') {
  const boundary = `----lastsize${randomBytes(8).toString('hex')}`;
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe.runIf(storageEnabled)('products', () => {
  let h: Harness;
  let c: ReturnType<typeof createClient>;
  beforeAll(async () => {
    h = await startHarness();
    c = createClient(h);
  });
  afterAll(async () => {
    await h?.close();
  });

  /** A seller with a store verified long ago (no "new store" flags). */
  async function verifiedSeller(verifiedDaysAgo = 365) {
    const seller = await c.register();
    const store = await c.createStoreFor(seller.userId);
    await h.database.db
      .update(stores)
      .set({ status: 'VERIFIED', verifiedAt: new Date(Date.now() - verifiedDaysAgo * 86_400_000) })
      .where(eq(stores.id, store.id));
    return { ...seller, storeId: store.id, base: `/api/v1/seller/stores/${store.id}` };
  }

  async function upload(
    cookie: string,
    storeId: string,
    file?: Buffer,
    filename?: string,
    type?: string,
  ) {
    const { payload, headers } = multipart(file ?? (await jpeg()), filename, type);
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/seller/stores/${storeId}/media`,
      payload,
      headers: { ...headers, cookie },
    });
  }

  async function mediaId(cookie: string, storeId: string) {
    const response = await upload(cookie, storeId);
    expect(response.statusCode).toBe(201);
    return response.json().id as string;
  }

  const sneakers = (mediaIds: string[], overrides: Record<string, unknown> = {}) => ({
    title: 'Air Max 270',
    brand: 'Nike',
    categoryId: SNEAKERS,
    gender: 'MEN',
    colorId: BLACK,
    article: 'AH8050-002',
    mediaIds,
    originalPrice: tenge(59_990),
    salePrice: tenge(39_990),
    variants: [
      { sizeValueId: SIZE_EU(40), quantity: 2 },
      { sizeValueId: SIZE_EU(41), quantity: 1 },
      { sizeValueId: SIZE_EU(42), quantity: 0 },
    ],
    ...overrides,
  });

  async function publishedProduct(
    seller: Awaited<ReturnType<typeof verifiedSeller>>,
    overrides: Record<string, unknown> = {},
  ) {
    const response = await c.json('POST', `${seller.base}/products`, {
      cookie: seller.cookie,
      body: {
        ...sneakers([await mediaId(seller.cookie, seller.storeId)]),
        publish: true,
        ...overrides,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
  }

  describe('photos', () => {
    it('stores processed photos and returns their public folder', async () => {
      const seller = await verifiedSeller();
      const response = await upload(seller.cookie, seller.storeId);
      expect(response.statusCode).toBe(201);
      const media = response.json();
      expect(media).toMatchObject({ width: 900, height: 1200, widths: [320, 640, 1080] });
      expect(media.url).toBe(`/media/products/${seller.storeId}/${media.id}/`);
      const [row] = await h.database.db
        .select()
        .from(storeMedia)
        .where(eq(storeMedia.id, media.id));
      expect(row).toMatchObject({ storeId: seller.storeId, width: 900 });
    });

    it('rejects files that are not photos, whatever their name says', async () => {
      const seller = await verifiedSeller();
      const response = await upload(
        seller.cookie,
        seller.storeId,
        Buffer.from('<script>alert(1)</script>'),
        'photo.jpg',
        'image/jpeg',
      );
      expect(response.statusCode).toBe(422);
      expect(response.json().errors).toEqual([{ path: 'file', message: 'image.unsupported' }]);
    });

    it('accepts uploads only into the seller’s own store', async () => {
      const a = await verifiedSeller();
      const b = await verifiedSeller();
      expect((await upload(a.cookie, b.storeId)).statusCode).toBe(404);
      const anonymous = multipart(await jpeg());
      const response = await h.app.inject({
        method: 'POST',
        url: `/api/v1/seller/stores/${a.storeId}/media`,
        ...anonymous,
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('creating and publishing', () => {
    it('publishes a product with sizes, stock and public price history', async () => {
      const seller = await verifiedSeller();
      const product = await publishedProduct(seller);
      expect(product).toMatchObject({
        status: 'ACTIVE',
        brand: 'Nike',
        discountPercent: 33,
        referencePrice: null,
        article: 'AH8050-002',
      });
      expect(product.slug).toBe('nike-air-max-270');
      expect(product.shortId).toMatch(/^[0-9a-z]{8}$/);
      expect(
        product.variants.map((v: { sizeLabel: string; available: number; sku: string }) => [
          v.sizeLabel,
          v.available,
          v.sku,
        ]),
      ).toEqual([
        ['40', 2, 'AH8050-002-40'],
        ['41', 1, 'AH8050-002-41'],
        ['42', 0, 'AH8050-002-42'],
      ]);
      const history = await h.database.db
        .select()
        .from(priceHistory)
        .where(eq(priceHistory.variantId, product.variants[0].id));
      expect(history.some((row) => row.isPublic)).toBe(true);
    });

    it('saves a draft below the minimum discount but refuses to publish it', async () => {
      const seller = await verifiedSeller();
      const media = await mediaId(seller.cookie, seller.storeId);
      const body = sneakers([media], { salePrice: tenge(49_990) }); // 16%
      const draft = await c.json('POST', `${seller.base}/products`, {
        cookie: seller.cookie,
        body,
      });
      expect(draft.json()).toMatchObject({ status: 'DRAFT', discountPercent: 16 });

      const publish = await c.json('POST', `${seller.base}/products/${draft.json().id}/status`, {
        cookie: seller.cookie,
        body: { action: 'publish' },
      });
      expect(publish.statusCode).toBe(422);
      expect(publish.json().errors).toEqual([{ path: 'salePrice', message: 'discount.tooSmall' }]);
    });

    it('lists every reason that blocks publishing', async () => {
      const seller = await c.register();
      const store = await c.createStoreFor(seller.userId); // still under review
      const response = await c.json('POST', `/api/v1/seller/stores/${store.id}/products`, {
        cookie: seller.cookie,
        body: {
          ...sneakers([], { variants: [{ sizeValueId: SIZE_EU(40), quantity: 0 }] }),
          publish: true,
        },
      });
      expect(response.statusCode).toBe(422);
      expect(
        response
          .json()
          .errors.map((e: { message: string }) => e.message)
          .sort(),
      ).toEqual(['images.required', 'stock.required', 'store.notVerified']);
      const created = await h.database.db
        .select()
        .from(products)
        .where(eq(products.storeId, store.id));
      expect(created).toHaveLength(0);
    });

    it('checks that sizes match the category', async () => {
      const seller = await verifiedSeller();
      const media = await mediaId(seller.cookie, seller.storeId);
      const wrong = await c.json('POST', `${seller.base}/products`, {
        cookie: seller.cookie,
        body: sneakers([media], { variants: [{ sizeValueId: SIZE_S, quantity: 1 }] }),
      });
      expect(wrong.json().errors).toEqual([{ path: 'variants', message: 'sizes.wrongChart' }]);

      const kidsDress = await c.json('POST', `${seller.base}/products`, {
        cookie: seller.cookie,
        body: sneakers([media], {
          categoryId: DRESSES,
          gender: 'KIDS',
          variants: [{ sizeValueId: KIDS_110, quantity: 1 }],
        }),
      });
      expect(kidsDress.statusCode).toBe(201);

      const bag = await c.json('POST', `${seller.base}/products`, {
        cookie: seller.cookie,
        body: sneakers([media], {
          categoryId: BAGS,
          gender: 'WOMEN',
          variants: [{ sizeValueId: null, quantity: 3 }],
        }),
      });
      expect(bag.json().variants).toEqual([
        expect.objectContaining({ sizeLabel: null, available: 3 }),
      ]);

      const parent = await c.json('POST', `${seller.base}/products`, {
        cookie: seller.cookie,
        body: sneakers([media], { categoryId: 2 }),
      });
      expect(parent.json().errors).toEqual([{ path: 'categoryId', message: 'category.invalid' }]);
    });

    it('does not let a store use another store’s photos', async () => {
      const a = await verifiedSeller();
      const b = await verifiedSeller();
      const foreign = await mediaId(b.cookie, b.storeId);
      const response = await c.json('POST', `${a.base}/products`, {
        cookie: a.cookie,
        body: sneakers([foreign]),
      });
      expect(response.json().errors).toEqual([{ path: 'mediaIds', message: 'images.notFound' }]);
    });

    it('rejects server-controlled fields in the request', async () => {
      const seller = await verifiedSeller();
      const response = await c.json('POST', `${seller.base}/products`, {
        cookie: seller.cookie,
        body: { ...sneakers([]), status: 'ACTIVE', discountPercent: 90 },
      });
      expect(response.statusCode).toBe(422);
    });

    it('flags an 80% discount from a store verified a few days ago', async () => {
      const seller = await verifiedSeller(5);
      const product = await publishedProduct(seller, {
        originalPrice: tenge(100_000),
        salePrice: tenge(15_000),
      });
      expect(product).toMatchObject({
        status: 'FLAGGED',
        flagReason: 'discount.suspiciousForNewStore',
      });
    });
  });

  describe('editing', () => {
    it('flags a raised price before discount and lets an admin clear the flag', async () => {
      const seller = await verifiedSeller();
      const product = await publishedProduct(seller);
      const raised = await c.json('PATCH', `${seller.base}/products/${product.id}`, {
        cookie: seller.cookie,
        body: { originalPrice: tenge(89_990), salePrice: tenge(39_990) },
      });
      expect(raised.json()).toMatchObject({
        status: 'FLAGGED',
        flagReason: 'price.originalRaised',
      });

      const admin = await c.makeVerifiedStaff();
      const feed = (
        await c.json('GET', '/api/v1/admin/products?filter=flagged', { cookie: admin.cookie })
      ).json();
      expect(feed.items.map((item: { id: string }) => item.id)).toContain(product.id);
      expect(
        (
          await c.json('POST', `/api/v1/admin/products/${product.id}/clear-flag`, {
            cookie: admin.cookie,
          })
        ).statusCode,
      ).toBe(204);
      const [row] = await h.database.db.select().from(products).where(eq(products.id, product.id));
      expect(row).toMatchObject({ status: 'ACTIVE', flagReason: null });
    });

    it('measures a later price cut from the price buyers saw', async () => {
      const seller = await verifiedSeller();
      const product = await publishedProduct(seller, {
        originalPrice: tenge(100_000),
        salePrice: tenge(50_000),
      });
      const cut = await c.json('PATCH', `${seller.base}/products/${product.id}`, {
        cookie: seller.cookie,
        body: { salePrice: tenge(30_000) },
      });
      // 50 000 → 30 000 is 40% off the public price, not 70% off the declared 100 000.
      expect(cut.json()).toMatchObject({ referencePrice: tenge(50_000), discountPercent: 40 });

      // Raising the price back up is not a discount from the 30 000 ₸ buyers already saw.
      const tooSmall = await c.json('PATCH', `${seller.base}/products/${product.id}`, {
        cookie: seller.cookie,
        body: { salePrice: tenge(45_000) },
      });
      expect(tooSmall.json().errors).toEqual([{ path: 'salePrice', message: 'discount.tooSmall' }]);
      // Hiding and republishing does not reset the reference either.
      const action = (name: string) =>
        c.json('POST', `${seller.base}/products/${product.id}/status`, {
          cookie: seller.cookie,
          body: { action: name },
        });
      await action('hide');
      await c.json('PATCH', `${seller.base}/products/${product.id}`, {
        cookie: seller.cookie,
        body: { salePrice: tenge(45_000) },
      });
      expect((await action('publish')).json().errors).toEqual([
        { path: 'salePrice', message: 'discount.tooSmall' },
      ]);
    });

    it('updates stock per size and refuses to drop units reserved by orders', async () => {
      const seller = await verifiedSeller();
      const product = await publishedProduct(seller);
      const size40 = product.variants[0];
      const [stock] = await h.database.db
        .select()
        .from(inventory)
        .where(eq(inventory.variantId, size40.id));
      await reserveStock(
        h.database.db,
        [{ variantId: size40.id, locationId: stock!.locationId, quantity: 1 }],
        { refType: 'test', refId: product.id },
      );

      const withoutReserved = await c.json('PATCH', `${seller.base}/products/${product.id}`, {
        cookie: seller.cookie,
        body: { variants: [{ sizeValueId: SIZE_EU(41), quantity: 5 }] },
      });
      expect(withoutReserved.json().errors).toEqual([
        { path: 'variants', message: 'stock.belowReserved' },
      ]);

      const ok = await c.json('PATCH', `${seller.base}/products/${product.id}`, {
        cookie: seller.cookie,
        body: {
          variants: [
            { sizeValueId: SIZE_EU(40), quantity: 1 },
            { sizeValueId: SIZE_EU(43), quantity: 4 },
          ],
        },
      });
      expect(
        ok
          .json()
          .variants.map((v: { sizeLabel: string; quantity: number; reserved: number }) => [
            v.sizeLabel,
            v.quantity,
            v.reserved,
          ]),
      ).toEqual([
        ['40', 1, 1],
        ['43', 4, 0],
      ]);
      const inactive = await h.database.db
        .select()
        .from(productVariants)
        .where(eq(productVariants.productId, product.id));
      expect(inactive.filter((v) => !v.isActive).length).toBe(2);
    });

    it('hides and republishes', async () => {
      const seller = await verifiedSeller();
      const product = await publishedProduct(seller);
      const action = (name: string) =>
        c.json('POST', `${seller.base}/products/${product.id}/status`, {
          cookie: seller.cookie,
          body: { action: name },
        });
      expect((await action('hide')).json().status).toBe('HIDDEN');
      expect((await action('hide')).statusCode).toBe(409);
      expect((await action('publish')).json().status).toBe('ACTIVE');
      expect((await action('archive')).json().status).toBe('ARCHIVED');
    });
  });

  describe('access', () => {
    it('hides one store’s products from another', async () => {
      const a = await verifiedSeller();
      const b = await verifiedSeller();
      const product = await publishedProduct(a);
      expect(
        (await c.json('GET', `${b.base}/products/${product.id}`, { cookie: b.cookie })).statusCode,
      ).toBe(404);
      expect(
        (await c.json('GET', `${a.base}/products/${product.id}`, { cookie: b.cookie })).statusCode,
      ).toBe(404);
      expect(
        (
          await c.json('PATCH', `${b.base}/products/${product.id}`, {
            cookie: b.cookie,
            body: { salePrice: 100 },
          })
        ).statusCode,
      ).toBe(404);
      const list = (await c.json('GET', `${b.base}/products`, { cookie: b.cookie })).json();
      expect(list.total).toBe(0);
    });

    it('lets an admin remove a product with a reason; the seller cannot bring it back alone', async () => {
      const seller = await verifiedSeller();
      const product = await publishedProduct(seller);
      expect(
        (
          await c.json('POST', `/api/v1/admin/products/${product.id}/remove`, {
            cookie: seller.cookie,
            body: { reason: 'Подделка бренда' },
          })
        ).statusCode,
      ).toBe(403);

      const admin = await c.makeVerifiedStaff();
      expect(
        (
          await c.json('POST', `/api/v1/admin/products/${product.id}/remove`, {
            cookie: admin.cookie,
            body: { reason: 'Подделка бренда' },
          })
        ).statusCode,
      ).toBe(204);
      const removed = (
        await c.json('GET', `${seller.base}/products/${product.id}`, { cookie: seller.cookie })
      ).json();
      expect(removed).toMatchObject({ status: 'REMOVED', removedReason: 'Подделка бренда' });
      expect(
        (
          await c.json('PATCH', `${seller.base}/products/${product.id}`, {
            cookie: seller.cookie,
            body: { title: 'Другое' },
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await c.json('POST', `${seller.base}/products/${product.id}/status`, {
            cookie: seller.cookie,
            body: { action: 'publish' },
          })
        ).statusCode,
      ).toBe(409);

      expect(
        (
          await c.json('POST', `/api/v1/admin/products/${product.id}/restore`, {
            cookie: admin.cookie,
          })
        ).statusCode,
      ).toBe(204);
      const republished = await c.json('POST', `${seller.base}/products/${product.id}/status`, {
        cookie: seller.cookie,
        body: { action: 'publish' },
      });
      expect(republished.json().status).toBe('ACTIVE');
    });
  });
});
