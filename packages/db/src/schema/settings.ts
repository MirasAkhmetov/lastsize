import { jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { updatedAt } from './columns.js';
import { users } from './identity.js';

/** Platform-wide settings editable by admins, e.g. the minimum discount to publish a product. */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: updatedAt(),
});
