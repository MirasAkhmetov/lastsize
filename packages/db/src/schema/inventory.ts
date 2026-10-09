import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './columns.js';
import { productVariants } from './catalog.js';
import { users } from './identity.js';
import { storeLocations } from './stores.js';

export const inventoryTransactionType = pgEnum('inventory_transaction_type', [
  'RESERVE',
  'RELEASE',
  'COMMIT',
  'ADJUST',
  'SYNC',
  'RETURN',
]);
export const priceChangeSource = pgEnum('price_change_source', ['SELLER', 'IMPORT', 'ADMIN']);

/**
 * Stock of a variant at a store location. The CHECK constraints make overselling impossible
 * at the database level: reserved can never exceed quantity.
 */
export const inventory = pgTable(
  'inventory',
  {
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => storeLocations.id),
    quantity: integer('quantity').notNull().default(0),
    reserved: integer('reserved').notNull().default(0),
    available: integer('available')
      .notNull()
      .generatedAlwaysAs(sql`quantity - reserved`),
    /** Last time the seller (or a sync) confirmed the count; shown as "stock updated N h ago". */
    stockConfirmedAt: timestamp('stock_confirmed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.variantId, t.locationId] }),
    check('inventory_quantity_non_negative', sql`${t.quantity} >= 0`),
    check('inventory_reserved_range', sql`${t.reserved} >= 0 AND ${t.reserved} <= ${t.quantity}`),
  ],
);

/** Append-only ledger of every stock movement. UPDATE and DELETE are rejected by a trigger. */
export const inventoryTransactions = pgTable(
  'inventory_transactions',
  {
    id: id(),
    variantId: uuid('variant_id').notNull(),
    locationId: uuid('location_id').notNull(),
    type: inventoryTransactionType('type').notNull(),
    quantityDelta: integer('quantity_delta').notNull(),
    reservedDelta: integer('reserved_delta').notNull(),
    quantityAfter: integer('quantity_after').notNull(),
    reservedAfter: integer('reserved_after').notNull(),
    /** What caused the movement, e.g. ('seller_order', <id>) or ('sync_job', <id>). */
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('inventory_transactions_variant_idx').on(t.variantId, t.createdAt),
    index('inventory_transactions_ref_idx').on(t.refType, t.refId),
  ],
);

/**
 * Every price change of a variant. Rows are written by a database trigger on product_variants,
 * so no code path can change a price without leaving history.
 */
export const priceHistory = pgTable(
  'price_history',
  {
    id: id(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    originalPrice: bigint('original_price', { mode: 'number' }).notNull(),
    salePrice: bigint('sale_price', { mode: 'number' }).notNull(),
    source: priceChangeSource('source').notNull(),
    /** The price was visible to buyers (product published). Only these count for the 30-day reference. */
    isPublic: boolean('is_public').notNull().default(false),
    changedBy: uuid('changed_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('price_history_variant_idx').on(t.variantId, t.createdAt)],
);
