import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { gender, productVariants, products } from './catalog.js';
import { createdAt, id, updatedAt } from './columns.js';
import { users } from './identity.js';
import { stores } from './stores.js';

export const integrationProvider = pgEnum('integration_provider', ['WILDBERRIES', 'KASPI_XML']);
export const integrationStatus = pgEnum('integration_status', ['ACTIVE', 'ERROR']);
export const importSource = pgEnum('import_source', ['WILDBERRIES', 'KASPI_XML', 'FILE']);
export const importRowStatus = pgEnum('import_row_status', [
  'READY',
  'NEEDS_ATTENTION',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'SKIPPED',
]);
export const importMappingKind = pgEnum('import_mapping_kind', ['CATEGORY', 'COLOR', 'SIZE']);

/** A store's connection to a marketplace. Settings never contain secrets. */
export const integrations = pgTable(
  'integrations',
  {
    id: id(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    provider: integrationProvider('provider').notNull(),
    status: integrationStatus('status').notNull().default('ACTIVE'),
    /** E.g. the Kaspi XML URL or the chosen WB warehouse id. */
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('integrations_store_provider_key').on(t.storeId, t.provider)],
);

/**
 * Marketplace API tokens, encrypted with SECRETS_ENCRYPTION_KEY (AES-256-GCM, bound to the
 * integration id). Never returned by the API and never logged; only the last 4 characters
 * are kept in clear to tell tokens apart.
 */
export const integrationCredentials = pgTable('integration_credentials', {
  integrationId: uuid('integration_id')
    .primaryKey()
    .references(() => integrations.id, { onDelete: 'cascade' }),
  ciphertext: text('ciphertext').notNull(),
  fingerprint: text('fingerprint').notNull(),
  keyVersion: smallint('key_version').notNull().default(1),
  createdAt: createdAt(),
});

export const importJobs = pgTable(
  'import_jobs',
  {
    id: id(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    source: importSource('source').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    /** Notes for the seller, e.g. "prices on WB are in RUB". */
    warnings: text('warnings')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('import_jobs_store_idx').on(t.storeId, t.createdAt)],
);

export interface ImportRowData {
  title: string;
  brand: string | null;
  description: string | null;
  article: string | null;
  /** Source category name, e.g. WB "Кроссовки". */
  sourceCategory: string | null;
  sourceColor: string | null;
  /** Source gender text, e.g. WB "Женский". */
  sourceGender: string | null;
  composition: string | null;
  photos: string[];
  sizes: {
    label: string | null;
    quantity: number;
    externalSizeId: string | null;
    barcode: string | null;
  }[];
}

export const importRows = pgTable(
  'import_rows',
  {
    id: id(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => importJobs.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    externalId: text('external_id').notNull(),
    data: jsonb('data').$type<ImportRowData>().notNull(),
    categoryId: smallint('category_id'),
    gender: gender('gender'),
    colorId: smallint('color_id'),
    /** Source size label → our size value id (null = not mapped yet). */
    sizeMap: jsonb('size_map').$type<Record<string, number | null>>().notNull().default({}),
    selected: boolean('selected').notNull().default(true),
    originalPrice: bigint('original_price', { mode: 'number' }),
    salePrice: bigint('sale_price', { mode: 'number' }),
    externalPrice: bigint('external_price', { mode: 'number' }),
    status: importRowStatus('status').notNull().default('NEEDS_ATTENTION'),
    issues: text('issues')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    /** Photos already downloaded for this row, so a retry does not fetch them again. */
    mediaIds: uuid('media_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('import_rows_job_position_key').on(t.jobId, t.position),
    index('import_rows_job_status_idx').on(t.jobId, t.status),
  ],
);

/** Choices a seller made once (WB "Кроссовки" → our sneakers), reused by later imports. */
export const importMappings = pgTable(
  'import_mappings',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    kind: importMappingKind('kind').notNull(),
    sourceValue: text('source_value').notNull(),
    targetId: integer('target_id').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.kind, t.sourceValue] })],
);

/** Which marketplace size a variant came from; used to sync stock both ways. */
export const externalListings = pgTable(
  'external_listings',
  {
    variantId: uuid('variant_id')
      .primaryKey()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    externalProductId: text('external_product_id').notNull(),
    externalSizeId: text('external_size_id'),
    barcode: text('barcode'),
    lastExternalStock: integer('last_external_stock'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('external_listings_integration_idx').on(t.integrationId, t.externalProductId)],
);
