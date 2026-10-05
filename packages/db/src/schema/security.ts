import { sql } from 'drizzle-orm';
import { index, inet, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from './columns.js';
import { users } from './identity.js';

/**
 * Server-side sessions of sellers and staff. The cookie holds a random token; only its SHA-256
 * hash is stored, so a database leak does not reveal usable session tokens.
 */
export const userSessions = pgTable(
  'user_sessions',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Set after a successful TOTP check; required for every admin action. */
    mfaVerifiedAt: timestamp('mfa_verified_at', { withTimezone: true }),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Sliding expiry, extended on use up to `absoluteExpiresAt`. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ip: inet('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    index('user_sessions_user_id_idx')
      .on(t.userId)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);

export const auditActorType = pgEnum('audit_actor_type', [
  'USER',
  'CUSTOMER',
  'SYSTEM',
  'ANONYMOUS',
]);

/** Append-only record of security-relevant and administrative actions. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    actorType: auditActorType('actor_type').notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    /** Extra context. Never contains passwords, tokens or other secrets. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_actor_idx').on(t.actorId, t.createdAt),
    index('audit_logs_entity_idx').on(t.entityType, t.entityId, t.createdAt),
    index('audit_logs_action_idx').on(t.action, t.createdAt),
  ],
);
