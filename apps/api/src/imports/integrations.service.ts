import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Integration } from '@lastsize/contracts';
import { and, type Database, eq, integrationCredentials, integrations, sql } from '@lastsize/db';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { DATABASE } from '../infrastructure/infrastructure.module';
import type { SecretBox } from '../security/secret-box';
import { SECRET_BOX } from '../security/security.module';
import { ValidationFailedException } from '../security/zod-validation.pipe';
import { WILDBERRIES_API, type WildberriesApi, WildberriesError } from './wildberries.client';

type Provider = 'WILDBERRIES' | 'KASPI_XML';
type Actor = { userId: string; request: FastifyRequest };

const KEY_VERSION = 1;
const credentialContext = (integrationId: string) => `integration:${integrationId}`;

export class MarketplaceUnavailableException extends HttpException {
  constructor() {
    super(
      'Wildberries не отвечает. Попробуйте через несколько минут.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

/** Maps WB failures to answers for the seller; nothing about the token is echoed back. */
export function wildberriesFailure(error: unknown): never {
  if (error instanceof WildberriesError) {
    if (error.code === 'wb.invalidToken')
      throw new ValidationFailedException([{ path: 'token', message: 'wb.tokenInvalid' }]);
    if (error.code === 'wb.forbidden')
      throw new ValidationFailedException([{ path: 'token', message: 'wb.tokenNoAccess' }]);
    throw new MarketplaceUnavailableException();
  }
  throw error;
}

/**
 * Marketplace connections of a store. API tokens are encrypted at rest, decrypted only for an
 * outgoing call to the marketplace, and never returned, logged or put into audit metadata.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(SECRET_BOX) private readonly secretBox: SecretBox,
    @Inject(WILDBERRIES_API) private readonly wildberries: WildberriesApi,
    private readonly audit: AuditService,
  ) {}

  async list(storeId: string): Promise<Integration[]> {
    const rows = await this.db
      .select({
        provider: integrations.provider,
        status: integrations.status,
        settings: integrations.settings,
        lastSuccessAt: integrations.lastSuccessAt,
        lastError: integrations.lastError,
        createdAt: integrations.createdAt,
        fingerprint: integrationCredentials.fingerprint,
      })
      .from(integrations)
      .leftJoin(integrationCredentials, eq(integrationCredentials.integrationId, integrations.id))
      .where(eq(integrations.storeId, storeId))
      .orderBy(integrations.provider);
    return rows.map((row) => ({
      provider: row.provider,
      status: row.status,
      tokenHint: row.fingerprint ? `••••${row.fingerprint}` : null,
      kaspiUrl: typeof row.settings.url === 'string' ? row.settings.url : null,
      lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
      lastError: row.lastError,
      connectedAt: row.createdAt.toISOString(),
    }));
  }

  async connectWildberries(storeId: string, token: string, actor: Actor): Promise<void> {
    await this.wildberries.verifyToken(token).catch(wildberriesFailure);
    await this.db.transaction(async (tx) => {
      const [integration] = await tx
        .insert(integrations)
        .values({ storeId, provider: 'WILDBERRIES' })
        .onConflictDoUpdate({
          target: [integrations.storeId, integrations.provider],
          set: { status: 'ACTIVE', lastError: null },
        })
        .returning({ id: integrations.id });
      const values = {
        ciphertext: this.secretBox.encrypt(token, credentialContext(integration!.id)),
        fingerprint: token.slice(-4),
        keyVersion: KEY_VERSION,
      };
      await tx
        .insert(integrationCredentials)
        .values({ integrationId: integration!.id, ...values })
        .onConflictDoUpdate({ target: integrationCredentials.integrationId, set: values });
    });
    await this.audit.record(
      {
        action: 'integration.connected',
        actorType: 'USER',
        actorId: actor.userId,
        entityType: 'store',
        entityId: storeId,
        metadata: { provider: 'WILDBERRIES' },
      },
      actor.request,
    );
  }

  /** Remembers the Kaspi price-list URL for later stock sync. */
  async rememberKaspiUrl(storeId: string, url: string): Promise<string> {
    const [row] = await this.db
      .insert(integrations)
      .values({ storeId, provider: 'KASPI_XML', settings: { url } })
      .onConflictDoUpdate({
        target: [integrations.storeId, integrations.provider],
        set: { settings: { url } },
      })
      .returning({ id: integrations.id });
    return row!.id;
  }

  async disconnect(storeId: string, provider: Provider, actor: Actor): Promise<void> {
    const [deleted] = await this.db
      .delete(integrations)
      .where(and(eq(integrations.storeId, storeId), eq(integrations.provider, provider)))
      .returning({ id: integrations.id });
    if (!deleted) throw new NotFoundException('Интеграция не подключена');
    await this.audit.record(
      {
        action: 'integration.disconnected',
        actorType: 'USER',
        actorId: actor.userId,
        entityType: 'store',
        entityId: storeId,
        metadata: { provider },
      },
      actor.request,
    );
  }

  /** Server-side only: the decrypted token for one outgoing call. */
  async wildberriesToken(
    storeId: string,
  ): Promise<{ integrationId: string; token: string } | null> {
    const [row] = await this.db
      .select({ id: integrations.id, ciphertext: integrationCredentials.ciphertext })
      .from(integrations)
      .innerJoin(integrationCredentials, eq(integrationCredentials.integrationId, integrations.id))
      .where(and(eq(integrations.storeId, storeId), eq(integrations.provider, 'WILDBERRIES')));
    if (!row) return null;
    return {
      integrationId: row.id,
      token: this.secretBox.decrypt(row.ciphertext, credentialContext(row.id)),
    };
  }

  async integrationId(storeId: string, provider: Provider): Promise<string | null> {
    const [row] = await this.db
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.storeId, storeId), eq(integrations.provider, provider)));
    return row?.id ?? null;
  }

  async recordOutcome(integrationId: string, errorCode: string | null): Promise<void> {
    await this.db
      .update(integrations)
      .set(
        errorCode
          ? { status: 'ERROR', lastError: errorCode }
          : { status: 'ACTIVE', lastError: null, lastSuccessAt: sql`now()` },
      )
      .where(eq(integrations.id, integrationId));
  }
}
