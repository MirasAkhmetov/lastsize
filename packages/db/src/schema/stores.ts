import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './columns.js';
import { users } from './identity.js';

export const storeStatus = pgEnum('store_status', [
  'PENDING_VERIFICATION',
  'VERIFIED',
  'REJECTED',
  'BLOCKED',
]);
export const storeMemberRole = pgEnum('store_member_role', ['SELLER', 'SELLER_MANAGER']);

export const cities = pgTable('cities', {
  id: smallint('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  nameRu: text('name_ru').notNull(),
  nameKk: text('name_kk').notNull(),
});

export const stores = pgTable(
  'stores',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    /** BIN or IIN, 12 digits. */
    binIin: text('bin_iin').notNull(),
    status: storeStatus('status').notNull().default('PENDING_VERIFICATION'),
    description: text('description'),
    logoKey: text('logo_key'),
    coverKey: text('cover_key'),
    instagram: text('instagram'),
    /** Share of a completed seller order taken by the platform, e.g. 0.0500 = 5%. */
    commissionRate: numeric('commission_rate', { precision: 5, scale: 4 }).notNull().default('0'),
    rating: numeric('rating', { precision: 3, scale: 2 }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: uuid('verified_by').references(() => users.id),
    rejectionReason: text('rejection_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('stores_slug_key').on(t.slug),
    index('stores_status_idx').on(t.status),
    check('stores_bin_iin_format', sql`${t.binIin} ~ '^[0-9]{12}$'`),
    check('stores_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check(
      'stores_commission_rate_range',
      sql`${t.commissionRate} >= 0 AND ${t.commissionRate} < 1`,
    ),
  ],
);

export const storeMembers = pgTable(
  'store_members',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: storeMemberRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.userId] }),
    index('store_members_user_id_idx').on(t.userId),
  ],
);

/** Weekly opening hours: { "mon": [["10:00","20:00"]], ..., "sun": [] }. */
export type StoreSchedule = Record<
  'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun',
  [string, string][]
>;

/** One store has exactly one address for now (unique store_id); lift the constraint for branches. */
export const storeLocations = pgTable(
  'store_locations',
  {
    id: id(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    cityId: smallint('city_id')
      .notNull()
      .references(() => cities.id),
    address: text('address').notNull(),
    latitude: numeric('latitude', { precision: 9, scale: 6 }),
    longitude: numeric('longitude', { precision: 9, scale: 6 }),
    schedule: jsonb('schedule').$type<StoreSchedule>().notNull(),
    phone: text('phone').notNull(),
    pickupEnabled: boolean('pickup_enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('store_locations_store_id_key').on(t.storeId),
    check('store_locations_coordinates', sql`(${t.latitude} IS NULL) = (${t.longitude} IS NULL)`),
  ],
);
