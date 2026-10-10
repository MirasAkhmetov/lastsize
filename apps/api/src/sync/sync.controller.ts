import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  type Integration,
  integrationListSchema,
  integrationProviderSchema,
  type SyncRun,
  syncRunListSchema,
  updateIntegrationRequestSchema,
  type Warehouse,
  warehouseListSchema,
} from '@lastsize/contracts';
import { and, type Database, desc, eq, integrations, syncRuns } from '@lastsize/db';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth, RequireStoreAccess } from '../auth/decorators';
import { IntegrationsService, wildberriesFailure } from '../imports/integrations.service';
import { WILDBERRIES_API, type WildberriesApi } from '../imports/wildberries.client';
import { DATABASE } from '../infrastructure/infrastructure.module';
import { RateLimiterService } from '../security/rate-limiter.service';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { SyncScheduler } from './sync-queue';

type Provider = z.output<typeof integrationProviderSchema>;
const providerPipe = new ZodValidationPipe(integrationProviderSchema);
const MANUAL_SYNC_LIMIT = { name: 'sync:manual', limit: 12, windowSeconds: 60 * 60 };

/** Stock sync settings and log of a store's marketplace connections (owner only). */
@Controller('seller/stores/:storeId/integrations')
export class SyncController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WILDBERRIES_API) private readonly wildberries: WildberriesApi,
    private readonly integrations: IntegrationsService,
    private readonly scheduler: SyncScheduler,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  @Patch(':provider')
  @RequireStoreAccess('integration:manage')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('storeId') storeId: string,
    @Param('provider', providerPipe) provider: Provider,
    @Body(new ZodValidationPipe(updateIntegrationRequestSchema))
    body: z.output<typeof updateIntegrationRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<Integration[]> {
    const id = await this.integrations.updateSettings(storeId, provider, body, {
      userId: auth.user.id,
      request,
    });
    if (body.syncEnabled !== false) await this.scheduler.request(id, 'MANUAL');
    return integrationListSchema.parse(await this.integrations.list(storeId));
  }

  /** The seller's WB warehouses, to choose the one to sync. */
  @Get('WILDBERRIES/warehouses')
  @RequireStoreAccess('integration:manage')
  async warehouses(@Param('storeId') storeId: string): Promise<Warehouse[]> {
    const credentials = await this.integrations.wildberriesToken(storeId);
    if (!credentials) throw new NotFoundException('Wildberries не подключён');
    return warehouseListSchema.parse(
      await this.wildberries.warehouses(credentials.token).catch(wildberriesFailure),
    );
  }

  @Post(':provider/sync')
  @HttpCode(202)
  @RequireStoreAccess('integration:manage')
  async syncNow(
    @Param('storeId') storeId: string,
    @Param('provider', providerPipe) provider: Provider,
  ): Promise<{ queued: true }> {
    const [integration] = await this.db
      .select({ id: integrations.id, settings: integrations.settings })
      .from(integrations)
      .where(and(eq(integrations.storeId, storeId), eq(integrations.provider, provider)));
    if (!integration) throw new NotFoundException('Интеграция не подключена');
    if (integration.settings.syncEnabled === false)
      throw new ConflictException('Синхронизация выключена');
    await this.rateLimiter.consume(MANUAL_SYNC_LIMIT, integration.id);
    await this.scheduler.request(integration.id, 'MANUAL');
    return { queued: true };
  }

  @Get(':provider/runs')
  @RequireStoreAccess('integration:manage')
  async runs(
    @Param('storeId') storeId: string,
    @Param('provider', providerPipe) provider: Provider,
  ): Promise<SyncRun[]> {
    const rows = await this.db
      .select({
        id: syncRuns.id,
        trigger: syncRuns.trigger,
        status: syncRuns.status,
        pulled: syncRuns.pulled,
        pushed: syncRuns.pushed,
        conflicts: syncRuns.conflicts,
        error: syncRuns.error,
        changes: syncRuns.changes,
        startedAt: syncRuns.startedAt,
        finishedAt: syncRuns.finishedAt,
      })
      .from(syncRuns)
      .innerJoin(integrations, eq(integrations.id, syncRuns.integrationId))
      .where(and(eq(integrations.storeId, storeId), eq(integrations.provider, provider)))
      .orderBy(desc(syncRuns.startedAt))
      .limit(20);
    return syncRunListSchema.parse(
      rows.map((row) => ({
        ...row,
        // Variant ids stay internal; the seller sees product and size.
        changes: row.changes.map(({ kind, title, size, from, to }) => ({
          kind,
          title,
          size,
          from,
          to,
        })),
        startedAt: row.startedAt.toISOString(),
        finishedAt: row.finishedAt?.toISOString() ?? null,
      })),
    );
  }
}
