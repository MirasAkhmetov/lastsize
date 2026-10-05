import { Inject, Injectable } from '@nestjs/common';
import { auditLogs, type Database } from '@lastsize/db';
import type { Logger } from '@lastsize/logger';
import type { FastifyRequest } from 'fastify';
import { DATABASE } from '../infrastructure/infrastructure.module';
import { APP_LOGGER } from '../logging';

export interface AuditEntry {
  action: string;
  actorType: 'USER' | 'CUSTOMER' | 'SYSTEM' | 'ANONYMOUS';
  actorId?: string | null;
  entityType?: string;
  entityId?: string;
  /** Context only. Never put passwords, tokens or codes here. */
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  /** Writes an audit entry. Failures are logged and never break the user's request. */
  async record(entry: AuditEntry, request?: FastifyRequest): Promise<void> {
    try {
      await this.db.insert(auditLogs).values({
        action: entry.action,
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata ?? null,
        ip: request?.ip ?? null,
        userAgent: request?.headers['user-agent']?.slice(0, 512) ?? null,
        requestId: request ? String(request.id) : null,
      });
    } catch (error) {
      this.logger.error({ err: error, action: entry.action }, 'failed to write audit log');
    }
  }
}
