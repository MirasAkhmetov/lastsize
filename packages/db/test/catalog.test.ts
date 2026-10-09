import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordPublishedPrices, setVariantPrices } from '../src/repositories/pricing.js';
import { ROLES } from '../src/rbac.js';
import { seedReferenceData } from '../src/seed.js';
import {
  categories,
  platformSettings,
  priceHistory,
  productVariants,
  rolePermissions,
  storeLocations,
} from '../src/schema/index.js';
import { createStore, createVariantWithStock } from './fixtures.js';
import { dbError, describePgError } from './db-error.js';
import { createTestDatabase, type TestDatabase, testDatabaseUrl } from '../src/testing.js';

describe.runIf(testDatabaseUrl)('catalog and reference data', () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => {
    await t?.drop();
  });

  it('computes the discount in the database, rounded down', async () => {
    const { variant } = await createVariantWithStock(t.db, {
      stock: 1,
      originalPrice: 5_999_000,
      salePrice: 3_999_000,
    });
    // (59 990 − 39 990) / 59 990 = 33.3% → 33
    expect(variant.discountPercent).toBe(33);
  });

  it('measures the discount from the lowest known price, not the declared one', async () => {
    const { variant } = await createVariantWithStock(t.db, {
      stock: 1,
      originalPrice: 10_000_000,
      salePrice: 4_000_000,
    });
    // Declared 100 000 ₸, but the item really sold for 60 000 ₸ on Wildberries.
    const [updated] = await t.db
      .update(productVariants)
      .set({ externalPrice: 6_000_000 })
      .where(eq(productVariants.id, variant.id))
      .returning();
    expect(updated!.discountPercent).toBe(33);
  });

  it('rejects a sale price above the original price', async () => {
    const { variant } = await createVariantWithStock(t.db, { stock: 1 });
    expect(
      describePgError(
        await dbError(
          t.db
            .update(productVariants)
            .set({ salePrice: 7_000_000 })
            .where(eq(productVariants.id, variant.id)),
        ),
      ),
    ).toMatch(/product_variants_sale_below_original/);
  });

  it('writes price history for every price change, with source and actor', async () => {
    const { variant } = await createVariantWithStock(t.db, { stock: 1 });
    await setVariantPrices(
      t.db,
      variant.id,
      { originalPrice: 5_999_000, salePrice: 2_999_000 },
      { source: 'IMPORT' },
    );
    // A non-price update must not create history.
    await t.db
      .update(productVariants)
      .set({ barcode: '4600000000000' })
      .where(eq(productVariants.id, variant.id));

    const history = await t.db
      .select()
      .from(priceHistory)
      .where(eq(priceHistory.variantId, variant.id))
      .orderBy(priceHistory.createdAt);
    expect(history.map((row) => [row.salePrice, row.source])).toEqual([
      [3_999_000, 'SELLER'],
      [2_999_000, 'IMPORT'],
    ]);
    expect(
      describePgError(
        await dbError(
          t.db.execute(sql`delete from price_history where variant_id = ${variant.id}`),
        ),
      ),
    ).toMatch(/append-only/);
  });

  it('ignores draft edits for the reference price and measures reductions from public prices', async () => {
    const { variant } = await createVariantWithStock(t.db, {
      stock: 1,
      originalPrice: 10_000_000,
      salePrice: 4_000_000,
    });
    // A typo fixed before publishing must not hurt the discount.
    await setVariantPrices(
      t.db,
      variant.id,
      { originalPrice: 10_000_000, salePrice: 3_500_000 },
      { source: 'SELLER' },
    );
    await recordPublishedPrices(t.db, [variant.id], null);
    const read = async () =>
      (await t.db.select().from(productVariants).where(eq(productVariants.id, variant.id)))[0]!;
    expect(await read()).toMatchObject({ referencePrice: null, discountPercent: 65 });

    // Published at 35 000 ₸; a later cut to 30 000 ₸ is a 14% discount, not 70%.
    await setVariantPrices(
      t.db,
      variant.id,
      { originalPrice: 10_000_000, salePrice: 3_000_000 },
      { source: 'SELLER', isPublic: true },
    );
    expect(await read()).toMatchObject({ referencePrice: 3_500_000, discountPercent: 14 });

    const history = await t.db
      .select()
      .from(priceHistory)
      .where(eq(priceHistory.variantId, variant.id))
      .orderBy(priceHistory.createdAt);
    expect(history.map((row) => [row.salePrice, row.isPublic])).toEqual([
      [4_000_000, false],
      [3_500_000, false],
      [3_500_000, true],
      [3_000_000, true],
    ]);
  });

  it('allows exactly one address per store', async () => {
    const { store } = await createStore(t.db);
    expect(
      describePgError(
        await dbError(
          t.db.insert(storeLocations).values({
            storeId: store.id,
            cityId: 1,
            address: 'Абая 52',
            schedule: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
            phone: '+77011234567',
          }),
        ),
      ),
    ).toMatch(/store_locations_store_id_key/);
  });

  it('seeds roles, categories and the 30% minimum discount, and is idempotent', async () => {
    await seedReferenceData(t.db);

    const sellerPermissions = await t.db
      .select({ code: rolePermissions.permissionCode })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleCode, 'SELLER'));
    expect(sellerPermissions.map((row) => row.code).sort()).toEqual(
      [...ROLES.SELLER.permissions].sort(),
    );

    const managerPermissions = await t.db
      .select({ code: rolePermissions.permissionCode })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleCode, 'SELLER_MANAGER'));
    expect(managerPermissions.map((row) => row.code)).not.toContain('integration:manage');

    const [sneakers] = await t.db.select().from(categories).where(eq(categories.slug, 'sneakers'));
    expect(sneakers).toMatchObject({ nameRu: 'Кроссовки', nameKk: 'Кроссовкалар', parentId: 2 });

    const [minDiscount] = await t.db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'catalog.min_discount_percent'));
    expect(minDiscount!.value).toBe(30);
  });

  it('keeps admin changes to settings when seeding again', async () => {
    await t.db
      .update(platformSettings)
      .set({ value: 40 })
      .where(eq(platformSettings.key, 'catalog.min_discount_percent'));
    await seedReferenceData(t.db);
    const [minDiscount] = await t.db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'catalog.min_discount_percent'));
    expect(minDiscount!.value).toBe(40);
  });
});
