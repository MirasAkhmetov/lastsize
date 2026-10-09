import { bigint, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from './columns.js';
import { users } from './identity.js';
import { stores } from './stores.js';

/**
 * Images uploaded by a store, before and after they are attached to products.
 * Files live in object storage, never in PostgreSQL: `baseKey` is the folder holding the
 * original (private bucket) and the resized AVIF/WebP versions (public bucket).
 */
export const storeMedia = pgTable(
  'store_media',
  {
    id: id(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    baseKey: text('base_key').notNull().unique(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('store_media_store_idx').on(t.storeId, t.createdAt)],
);
