import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './columns.js';

export const userStatus = pgEnum('user_status', ['ACTIVE', 'BLOCKED']);
export const locale = pgEnum('locale', ['ru', 'kk']);

/** Sellers, store managers and platform staff. Customers are guests (see `customers`). */
export const users = pgTable(
  'users',
  {
    id: id(),
    phone: text('phone').notNull(),
    email: text('email'),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    status: userStatus('status').notNull().default('ACTIVE'),
    /** Set when an admin confirmed the number by phone call or the Telegram bot shared it. */
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    telegramUserId: bigint('telegram_user_id', { mode: 'bigint' }),
    totpSecretEncrypted: text('totp_secret_encrypted'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_phone_key').on(t.phone),
    uniqueIndex('users_email_key').on(sql`lower(${t.email})`),
    uniqueIndex('users_telegram_user_id_key').on(t.telegramUserId),
    check('users_phone_e164', sql`${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
  ],
);

/** Global roles. Store-level roles live in `store_members`. */
export const roles = pgTable('roles', {
  code: text('code').primaryKey(),
  description: text('description').notNull(),
});

export const permissions = pgTable('permissions', {
  code: text('code').primaryKey(),
  description: text('description').notNull(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleCode: text('role_code')
      .notNull()
      .references(() => roles.code, { onDelete: 'cascade' }),
    permissionCode: text('permission_code')
      .notNull()
      .references(() => permissions.code, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleCode, t.permissionCode] })],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleCode: text('role_code')
      .notNull()
      .references(() => roles.code),
    grantedBy: uuid('granted_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleCode] })],
);

/**
 * A guest buyer, identified by an HttpOnly device cookie. Only the SHA-256 hash of the device
 * token is stored. Name and phone are what the buyer typed at checkout; the phone is not verified.
 */
export const customers = pgTable(
  'customers',
  {
    id: id(),
    deviceTokenHash: text('device_token_hash').notNull(),
    name: text('name'),
    phone: text('phone'),
    locale: locale('locale').notNull().default('ru'),
    linkedUserId: uuid('linked_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('customers_device_token_hash_key').on(t.deviceTokenHash),
    index('customers_phone_idx').on(t.phone),
  ],
);
