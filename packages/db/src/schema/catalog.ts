import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './columns.js';
import { users } from './identity.js';
import { storeMedia } from './media.js';
import { stores } from './stores.js';

export const gender = pgEnum('gender', ['WOMEN', 'MEN', 'UNISEX', 'KIDS']);
/** Only new goods are sold for now; the enum leaves room for other conditions later. */
export const productCondition = pgEnum('product_condition', ['NEW']);
export const productStatus = pgEnum('product_status', [
  'DRAFT',
  'ACTIVE',
  'HIDDEN',
  'FLAGGED',
  'REMOVED',
  'ARCHIVED',
]);

/** A size system: international clothing sizes, EU shoe sizes, kids' height. */
export const sizeCharts = pgTable('size_charts', {
  id: smallint('id').primaryKey(),
  code: text('code').notNull().unique(),
  nameRu: text('name_ru').notNull(),
  nameKk: text('name_kk').notNull(),
});

export const sizeValues = pgTable(
  'size_values',
  {
    id: smallint('id').primaryKey(),
    chartId: smallint('chart_id')
      .notNull()
      .references(() => sizeCharts.id),
    code: text('code').notNull(),
    position: smallint('position').notNull(),
  },
  (t) => [uniqueIndex('size_values_chart_code_key').on(t.chartId, t.code)],
);

export const categories = pgTable(
  'categories',
  {
    id: smallint('id').primaryKey(),
    parentId: smallint('parent_id').references((): AnyPgColumn => categories.id),
    slug: text('slug').notNull(),
    nameRu: text('name_ru').notNull(),
    nameKk: text('name_kk').notNull(),
    /** Size system used by products of this category; null for one-size goods. */
    sizeChartId: smallint('size_chart_id').references(() => sizeCharts.id),
    position: smallint('position').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('categories_parent_slug_key').on(sql`coalesce(${t.parentId}, 0)`, t.slug),
    check('categories_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

export const brands = pgTable(
  'brands',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('brands_slug_key').on(t.slug),
    uniqueIndex('brands_name_key').on(sql`lower(${t.name})`),
  ],
);

export const colors = pgTable('colors', {
  id: smallint('id').primaryKey(),
  code: text('code').notNull().unique(),
  nameRu: text('name_ru').notNull(),
  nameKk: text('name_kk').notNull(),
  hex: text('hex'),
});

export const products = pgTable(
  'products',
  {
    id: id(),
    /** Short public id used in URLs: /product/nike-air-max-270-black-k7f2q9mx */
    shortId: text('short_id').notNull(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    brandId: uuid('brand_id').references(() => brands.id),
    categoryId: smallint('category_id')
      .notNull()
      .references(() => categories.id),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    composition: text('composition'),
    gender: gender('gender').notNull(),
    condition: productCondition('condition').notNull().default('NEW'),
    status: productStatus('status').notNull().default('DRAFT'),
    /** Why the system flagged the product for an admin look (status FLAGGED). */
    flagReason: text('flag_reason'),
    removedReason: text('removed_reason'),
    removedBy: uuid('removed_by').references(() => users.id),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('products_short_id_key').on(t.shortId),
    index('products_store_id_idx').on(t.storeId, t.status),
    index('products_category_active_idx')
      .on(t.categoryId, t.publishedAt.desc())
      .where(sql`${t.status} IN ('ACTIVE', 'FLAGGED')`),
    check('products_short_id_format', sql`${t.shortId} ~ '^[0-9a-z]{8}$'`),
    check('products_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check(
      'products_removed_has_reason',
      sql`${t.status} <> 'REMOVED' OR (${t.removedReason} IS NOT NULL AND ${t.removedAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * One sellable unit: a size (and colour) of a product. Prices are integers in tiyn (1 ₸ = 100 tiyn).
 * `discount_percent` is computed by the database from the reference price, so it cannot be forged.
 */
export const productVariants = pgTable(
  'product_variants',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** Denormalised from products so that SKUs are unique per store. */
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    sku: text('sku').notNull(),
    article: text('article'),
    barcode: text('barcode'),
    sizeValueId: smallint('size_value_id').references(() => sizeValues.id),
    colorId: smallint('color_id').references(() => colors.id),
    originalPrice: bigint('original_price', { mode: 'number' }).notNull(),
    salePrice: bigint('sale_price', { mode: 'number' }).notNull(),
    /** Lowest price of the last 30 days, maintained by the pricing service (anti fake discounts). */
    referencePrice: bigint('reference_price', { mode: 'number' }),
    /** Actual selling price on Wildberries or Kaspi for imported goods. */
    externalPrice: bigint('external_price', { mode: 'number' }),
    discountPercent: smallint('discount_percent')
      .notNull()
      .generatedAlwaysAs(
        sql`((least(original_price, coalesce(reference_price, original_price), coalesce(external_price, original_price)) - sale_price) * 100 / least(original_price, coalesce(reference_price, original_price), coalesce(external_price, original_price)))::smallint`,
      ),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('product_variants_store_sku_key').on(t.storeId, t.sku),
    uniqueIndex('product_variants_product_size_color_key').on(
      t.productId,
      sql`coalesce(${t.sizeValueId}, 0)`,
      sql`coalesce(${t.colorId}, 0)`,
    ),
    index('product_variants_product_id_idx').on(t.productId),
    check('product_variants_sale_price_positive', sql`${t.salePrice} > 0`),
    check('product_variants_sale_below_original', sql`${t.salePrice} <= ${t.originalPrice}`),
    check(
      'product_variants_reference_positive',
      sql`${t.referencePrice} IS NULL OR ${t.referencePrice} > 0`,
    ),
    check(
      'product_variants_external_positive',
      sql`${t.externalPrice} IS NULL OR ${t.externalPrice} > 0`,
    ),
  ],
);

export const productImages = pgTable(
  'product_images',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    colorId: smallint('color_id').references(() => colors.id),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => storeMedia.id),
    position: smallint('position').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('product_images_product_position_key').on(t.productId, t.position),
    uniqueIndex('product_images_product_media_key').on(t.productId, t.mediaId),
  ],
);
