import { randomBytes } from 'node:crypto';
import type { Database } from '../src/client.js';
import { productVariants, products, storeLocations, stores } from '../src/schema/index.js';
import { setStockLevel } from '../src/repositories/inventory.js';

const shortId = () => randomBytes(8).toString('hex').slice(0, 8);
const digits = (length: number) =>
  Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');

const schedule = {
  mon: [['10:00', '20:00']],
  tue: [['10:00', '20:00']],
  wed: [['10:00', '20:00']],
  thu: [['10:00', '20:00']],
  fri: [['10:00', '20:00']],
  sat: [['10:00', '20:00']],
  sun: [],
} as const satisfies Record<string, [string, string][] | readonly []>;

export async function createStore(db: Database) {
  const [store] = await db
    .insert(stores)
    .values({ slug: `store-${shortId()}`, name: 'Sneakerhead', binIin: digits(12) })
    .returning();
  const [location] = await db
    .insert(storeLocations)
    .values({
      storeId: store!.id,
      cityId: 1,
      address: 'ТЦ Mega Alma-Ata, 2 этаж',
      schedule: schedule as never,
      phone: '+77011234567',
    })
    .returning();
  return { store: store!, location: location! };
}

/** A sneaker in EU size 42 with the given stock. */
export async function createVariantWithStock(
  db: Database,
  input: { stock: number; originalPrice?: number; salePrice?: number },
) {
  const { store, location } = await createStore(db);
  const [product] = await db
    .insert(products)
    .values({
      shortId: shortId(),
      storeId: store.id,
      categoryId: 201,
      slug: 'nike-air-max-270',
      title: 'Nike Air Max 270',
      gender: 'MEN',
    })
    .returning();
  const [variant] = await db
    .insert(productVariants)
    .values({
      productId: product!.id,
      storeId: store.id,
      sku: `AH8050-${shortId()}`,
      sizeValueId: 2023, // EU 42
      colorId: 1,
      originalPrice: input.originalPrice ?? 5_999_000,
      salePrice: input.salePrice ?? 3_999_000,
    })
    .returning();
  await setStockLevel(
    db,
    { variantId: variant!.id, locationId: location.id, quantity: input.stock },
    { refType: 'test', refId: variant!.id },
  );
  return { store, location, product: product!, variant: variant! };
}
