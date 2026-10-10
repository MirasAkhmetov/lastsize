import { randomBytes } from 'node:crypto';
import {
  brands,
  eq,
  priceHistory,
  products,
  productVariants,
  recordPublishedPrices,
  setStockLevel,
  setVariantPrices,
  storeLocations,
  stores,
} from '@lastsize/db';
import { slugify } from '@lastsize/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from './client';
import { type Harness, integrationEnabled, startHarness } from './harness';

const EU = (size: number) => 2000 + (size - 19);
const SIZE_M = 1003;
const tenge = (value: number) => value * 100;

describe.runIf(integrationEnabled)('storefront', () => {
  let h: Harness;
  let c: ReturnType<typeof createClient>;
  let storeA: { id: string; slug: string; locationId: string };
  let storeB: { id: string; slug: string; locationId: string };

  async function makeStore(
    name: string,
    status: 'VERIFIED' | 'PENDING_VERIFICATION' = 'VERIFIED',
    pickup = true,
  ) {
    const seller = await c.register();
    const store = await c.createStoreFor(seller.userId);
    await h.database.db
      .update(stores)
      .set({ name, status, verifiedAt: status === 'VERIFIED' ? new Date() : null })
      .where(eq(stores.id, store.id));
    const [location] = await h.database.db
      .update(storeLocations)
      .set({ pickupEnabled: pickup })
      .where(eq(storeLocations.storeId, store.id))
      .returning();
    return { id: store.id, slug: store.slug, locationId: location!.id };
  }

  /** Inserts a published product directly (catalog tests do not need photo storage). */
  async function product(
    store: { id: string; locationId: string },
    input: {
      title: string;
      brand: string;
      categoryId: number;
      gender?: 'WOMEN' | 'MEN' | 'UNISEX' | 'KIDS';
      original: number;
      sale: number;
      sizes: [number | null, number][];
      status?: 'ACTIVE' | 'DRAFT' | 'HIDDEN' | 'REMOVED' | 'FLAGGED';
      article?: string;
      colorId?: number;
    },
  ) {
    const brandSlug = slugify(input.brand);
    await h.database.db
      .insert(brands)
      .values({ name: input.brand, slug: brandSlug })
      .onConflictDoNothing();
    const [brand] = await h.database.db.select().from(brands).where(eq(brands.slug, brandSlug));
    const shortId = randomBytes(8)
      .toString('hex')
      .slice(0, 8)
      .replace(/[^0-9a-z]/g, 'a');
    const status = input.status ?? 'ACTIVE';
    const [row] = await h.database.db
      .insert(products)
      .values({
        shortId,
        storeId: store.id,
        brandId: brand!.id,
        categoryId: input.categoryId,
        slug: slugify(`${input.brand} ${input.title}`),
        title: input.title,
        gender: input.gender ?? 'WOMEN',
        status,
        publishedAt: new Date(),
        ...(status === 'REMOVED' ? { removedReason: 'test', removedAt: new Date() } : {}),
      })
      .returning();
    const variantIds: string[] = [];
    for (const [size, quantity] of input.sizes) {
      const [variant] = await h.database.db
        .insert(productVariants)
        .values({
          productId: row!.id,
          storeId: store.id,
          sku: `${shortId}-${size ?? 'one'}`,
          article: input.article ?? null,
          sizeValueId: size,
          colorId: input.colorId ?? 1,
          originalPrice: tenge(input.original),
          salePrice: tenge(input.sale),
        })
        .returning();
      variantIds.push(variant!.id);
      await setStockLevel(
        h.database.db,
        { variantId: variant!.id, locationId: store.locationId, quantity },
        { refType: 'test', refId: row!.id },
      );
    }
    if (status === 'ACTIVE' || status === 'FLAGGED')
      await recordPublishedPrices(h.database.db, variantIds, null);
    return { ...row!, variantIds };
  }

  const get = async (query: string) => {
    const response = await c.json('GET', `/api/v1/catalog/products${query}`);
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  };
  const titles = (body: { items: { title: string }[] }) =>
    body.items.map((item) => item.title).sort();

  beforeAll(async () => {
    h = await startHarness();
    c = createClient(h);
    storeA = await makeStore('Sneakerhead');
    storeB = await makeStore('Nora Showroom', 'VERIFIED', false);
    const pending = await makeStore('Pending Store', 'PENDING_VERIFICATION');

    await product(storeA, {
      title: 'Air Max 270',
      brand: 'Nike',
      categoryId: 201,
      gender: 'MEN',
      original: 59_990,
      sale: 39_990,
      sizes: [
        [EU(40), 2],
        [EU(41), 0],
      ],
      article: 'AH8050-002',
    });
    await product(storeA, {
      title: 'Dunk Low',
      brand: 'Nike',
      categoryId: 201,
      gender: 'UNISEX',
      original: 54_990,
      sale: 19_990,
      sizes: [[EU(38), 1]],
    });
    await product(storeA, {
      title: 'Samba OG',
      brand: 'Adidas',
      categoryId: 201,
      gender: 'WOMEN',
      original: 64_990,
      sale: 44_990,
      sizes: [
        [EU(37), 3],
        [EU(38), 3],
      ],
    });
    await product(storeB, {
      title: 'Тренч оверсайз 100%',
      brand: 'Nora',
      categoryId: 101,
      gender: 'WOMEN',
      original: 69_990,
      sale: 34_990,
      sizes: [[SIZE_M, 1]],
      colorId: 4,
    });
    await product(storeB, {
      title: 'Sold out boots',
      brand: 'Nora',
      categoryId: 202,
      gender: 'WOMEN',
      original: 50_000,
      sale: 30_000,
      sizes: [[EU(38), 0]],
    });
    // Not for buyers:
    await product(storeA, {
      title: 'Draft sneaker',
      brand: 'Nike',
      categoryId: 201,
      original: 50_000,
      sale: 30_000,
      sizes: [[EU(40), 5]],
      status: 'DRAFT',
    });
    await product(storeA, {
      title: 'Hidden sneaker',
      brand: 'Nike',
      categoryId: 201,
      original: 50_000,
      sale: 30_000,
      sizes: [[EU(40), 5]],
      status: 'HIDDEN',
    });
    await product(storeA, {
      title: 'Removed sneaker',
      brand: 'Nike',
      categoryId: 201,
      original: 50_000,
      sale: 30_000,
      sizes: [[EU(40), 5]],
      status: 'REMOVED',
    });
    await product(pending, {
      title: 'Pending store sneaker',
      brand: 'Nike',
      categoryId: 201,
      original: 50_000,
      sale: 30_000,
      sizes: [[EU(40), 5]],
    });
  });
  afterAll(async () => {
    await h?.close();
  });

  it('shows only published, in-stock products of verified stores', async () => {
    const body = await get('');
    expect(titles(body)).toEqual(['Air Max 270', 'Dunk Low', 'Samba OG', 'Тренч оверсайз 100%']);
    expect(body.total).toBe(4);
    const card = body.items.find((item: { title: string }) => item.title === 'Air Max 270');
    expect(card).toMatchObject({
      brand: 'Nike',
      discountPercent: 33,
      available: 2,
      store: { slug: storeA.slug, name: 'Sneakerhead', city: { ru: 'Алматы' } },
      sizes: [
        { id: EU(40), label: '40', available: 2 },
        { id: EU(41), label: '41', available: 0 },
      ],
    });
  });

  it('filters by category, gender (women include unisex), size in stock, price, discount, brand, store and pickup', async () => {
    expect(titles(await get('?category=shoes'))).toEqual(['Air Max 270', 'Dunk Low', 'Samba OG']);
    expect(titles(await get('?category=dresses'))).toEqual(['Тренч оверсайз 100%']);
    expect(titles(await get('?gender=women&category=sneakers'))).toEqual(['Dunk Low', 'Samba OG']);
    expect(titles(await get(`?size=${EU(41)}`))).toEqual([]); // 41 is sold out
    expect(titles(await get(`?size=${EU(40)},${EU(37)}`))).toEqual(['Air Max 270', 'Samba OG']);
    expect(titles(await get('?priceMin=30000&priceMax=40000'))).toEqual([
      'Air Max 270',
      'Тренч оверсайз 100%',
    ]);
    expect(titles(await get('?discount=50'))).toEqual(['Dunk Low', 'Тренч оверсайз 100%']); // 63% and exactly 50%
    expect(titles(await get('?discount=70'))).toEqual([]);
    expect(titles(await get('?brand=adidas'))).toEqual(['Samba OG']);
    expect(titles(await get(`?store=${storeB.slug}`))).toEqual(['Тренч оверсайз 100%']);
    expect(titles(await get('?pickup=1'))).toEqual(['Air Max 270', 'Dunk Low', 'Samba OG']);
    expect(titles(await get('?color=beige'))).toEqual(['Тренч оверсайз 100%']);
  });

  it('sorts by price, discount and last sizes', async () => {
    expect((await get('?sort=price_asc')).items.map((i: { title: string }) => i.title)).toEqual([
      'Dunk Low',
      'Тренч оверсайз 100%',
      'Air Max 270',
      'Samba OG',
    ]);
    expect((await get('?sort=discount')).items[0].title).toBe('Dunk Low');
    expect(
      (await get('?sort=last_sizes')).items.map((i: { available: number }) => i.available),
    ).toEqual([1, 1, 2, 6]);
  });

  it('searches titles, brands, stores and articles, treating % literally', async () => {
    expect(titles(await get('?q=air'))).toEqual(['Air Max 270']);
    expect(titles(await get('?q=NIKE'))).toEqual(['Air Max 270', 'Dunk Low']);
    expect(titles(await get('?q=nora show'))).toEqual(['Тренч оверсайз 100%']);
    expect(titles(await get('?q=ah8050'))).toEqual(['Air Max 270']);
    expect(titles(await get('?q=100%25'))).toEqual(['Тренч оверсайз 100%']);
    expect(titles(await get('?q=%25'))).toEqual(['Тренч оверсайз 100%']);
    expect(titles(await get('?q=_'))).toEqual([]);
  });

  it('returns filter options counted within the category', async () => {
    const { facets } = await get('?category=sneakers');
    expect(facets.brands).toEqual([
      { value: 'nike', label: 'Nike', count: 2 },
      { value: 'adidas', label: 'Adidas', count: 1 },
    ]);
    expect(
      facets.sizes.map((s: { label: string; count: number }) => `${s.label}:${s.count}`),
    ).toEqual(['37:1', '38:2', '40:1']);
    expect(facets.price).toEqual({ min: 19_990, max: 44_990 });
  });

  it('rejects malformed filters instead of running them', async () => {
    for (const query of [
      "?brand=nike'--",
      '?size=1;drop',
      '?discount=45',
      '?sort=random',
      '?page=0',
      '?category=Shoes',
    ]) {
      expect((await c.json('GET', `/api/v1/catalog/products${query}`)).statusCode, query).toBe(422);
    }
    expect((await c.json('GET', '/api/v1/catalog/products?category=unknown')).statusCode).toBe(404);
  });

  it('serves a product page with sizes, store and public price history', async () => {
    const list = await get('?q=air');
    const shortId = list.items[0].shortId;
    const response = await c.json('GET', `/api/v1/catalog/products/${shortId}`);
    expect(response.statusCode).toBe(200);
    const detail = response.json();
    expect(detail).toMatchObject({
      title: 'Air Max 270',
      brand: { name: 'Nike', slug: 'nike' },
      category: { slug: 'sneakers', parent: { slug: 'shoes' } },
      article: 'AH8050-002',
      salePrice: tenge(39_990),
      discountPercent: 33,
      available: 2,
      store: { slug: storeA.slug, pickupEnabled: true, address: 'Абая 52' },
    });
    expect(detail.priceHistory).toEqual([expect.objectContaining({ salePrice: tenge(39_990) })]);

    // A later cut adds a point; republishing at the same price does not.
    const variantId = detail.sizes[0].variantId;
    await setVariantPrices(
      h.database.db,
      variantId,
      { originalPrice: tenge(59_990), salePrice: tenge(34_990) },
      { source: 'SELLER', isPublic: true },
    );
    const again = (await c.json('GET', `/api/v1/catalog/products/${shortId}`)).json();
    expect(again.priceHistory.map((p: { salePrice: number }) => p.salePrice)).toEqual([
      tenge(39_990),
      tenge(34_990),
    ]);
    const history = await h.database.db
      .select()
      .from(priceHistory)
      .where(eq(priceHistory.variantId, variantId));
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it('hides products that buyers must not see, and unknown ids, behind 404', async () => {
    const [draft] = await h.database.db
      .select()
      .from(products)
      .where(eq(products.title, 'Draft sneaker'));
    const [pending] = await h.database.db
      .select()
      .from(products)
      .where(eq(products.title, 'Pending store sneaker'));
    for (const id of [draft!.shortId, pending!.shortId, 'zzzzzzzz', "1' or '1"]) {
      expect(
        (await c.json('GET', `/api/v1/catalog/products/${encodeURIComponent(id)}`)).statusCode,
        id,
      ).toBe(404);
    }
  });

  it('serves public store pages only for verified stores', async () => {
    const response = await c.json('GET', `/api/v1/stores/${storeA.slug}`);
    expect(response.json()).toMatchObject({
      name: 'Sneakerhead',
      productCount: 3,
      pickupEnabled: true,
      city: { ru: 'Алматы' },
    });
    expect(response.body).not.toMatch(/bin|binIin|971240001315|commission/i);
    const [pending] = await h.database.db
      .select()
      .from(stores)
      .where(eq(stores.name, 'Pending Store'));
    expect((await c.json('GET', `/api/v1/stores/${pending!.slug}`)).statusCode).toBe(404);
  });

  it('lists public products and stores for the sitemap', async () => {
    const sitemap = (await c.json('GET', '/api/v1/catalog/sitemap')).json();
    expect(sitemap.products).toHaveLength(5); // includes the sold-out product: its page still exists
    expect(sitemap.stores.map((s: { slug: string }) => s.slug)).toEqual(
      expect.arrayContaining([storeA.slug, storeB.slug]),
    );
    expect(sitemap.stores).toHaveLength(2);
  });
});
