import { Inject, Injectable } from '@nestjs/common';
import {
  applySyncDelta,
  type Database,
  eq,
  externalListings,
  integrations,
  inventory,
  platformSettings,
  products,
  productVariants,
  sizeValues,
  sql,
  type SyncChange,
  syncRuns,
} from '@lastsize/db';
import type { Logger } from '@lastsize/logger';
import { API_ENV, type ApiEnv } from '../config/api-env';
import { SourceRejectedError } from '../imports/candidate';
import { IntegrationsService } from '../imports/integrations.service';
import { kaspiStock } from '../imports/kaspi-xml';
import { FetchRejectedError, safeFetch } from '../imports/safe-fetch';
import {
  WILDBERRIES_API,
  type WildberriesApi,
  WildberriesError,
} from '../imports/wildberries.client';
import { DATABASE } from '../infrastructure/infrastructure.module';
import { APP_LOGGER } from '../logging';
import type { SyncTrigger } from './sync-queue';

/** Another sync of the same integration is running; the job is retried later. */
export class SyncBusyError extends Error {
  constructor() {
    super('sync already running');
    this.name = 'SyncBusyError';
  }
}

type RunStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';
export interface SyncOutcome {
  runId: string;
  status: RunStatus;
  pulled: number;
  pushed: number;
  conflicts: number;
  error: string | null;
}

/** A sync that started this long ago is considered crashed and may be taken over. */
const STALE_CLAIM = '15 minutes';
const MAX_LOGGED_CHANGES = 100;
const KASPI_MAX_BYTES = 20 * 1024 * 1024;
const RUN_RETENTION = '30 days';

function errorCode(error: unknown): string | null {
  if (error instanceof WildberriesError) return error.code;
  if (error instanceof FetchRejectedError || error instanceof SourceRejectedError)
    return error.code;
  return null;
}

/**
 * Keeps one physical stock in step with a marketplace.
 *
 * Pull: a change of the marketplace count since the last sync (sold there, or edited there) is
 * applied to our count as a delta, so sales on both sides add up. Units reserved by our buyers
 * are never taken away; when the marketplace sold them too, the run reports a conflict.
 * Push (WB, opt-in): our available stock (on hand − reserved) is written back, so an item
 * reserved or sold here disappears from WB too.
 * Prices: the marketplace selling price is refreshed; a public product whose discount drops
 * below the minimum because of it is flagged for a moderator.
 */
@Injectable()
export class StockSyncService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    @Inject(WILDBERRIES_API) private readonly wildberries: WildberriesApi,
    private readonly integrationsService: IntegrationsService,
  ) {}

  async run(integrationId: string, trigger: SyncTrigger): Promise<SyncOutcome | null> {
    const [claimed] = await this.db
      .update(integrations)
      .set({ syncStartedAt: sql`now()` })
      .where(
        sql`${integrations.id} = ${integrationId} and (${integrations.syncStartedAt} is null or ${integrations.syncStartedAt} < now() - ${sql.raw(`interval '${STALE_CLAIM}'`)})`,
      )
      .returning();
    if (!claimed) {
      const [exists] = await this.db
        .select({ id: integrations.id })
        .from(integrations)
        .where(eq(integrations.id, integrationId));
      if (!exists) return null;
      throw new SyncBusyError();
    }

    try {
      if (claimed.settings.syncEnabled === false) return null;
      const [run] = await this.db
        .insert(syncRuns)
        .values({ integrationId, trigger })
        .returning({ id: syncRuns.id });
      const outcome = await this.execute(claimed, run!.id);
      await this.db
        .update(syncRuns)
        .set({
          status: outcome.status,
          pulled: outcome.pulled,
          pushed: outcome.pushed,
          conflicts: outcome.conflicts,
          error: outcome.error,
          changes: outcome.changes.slice(0, MAX_LOGGED_CHANGES),
          finishedAt: sql`now()`,
        })
        .where(eq(syncRuns.id, run!.id));
      await this.db
        .update(integrations)
        .set(
          outcome.status === 'FAILED'
            ? { status: 'ERROR', lastError: outcome.error, lastSyncAt: sql`now()` }
            : {
                status: 'ACTIVE',
                lastError: outcome.error,
                lastSyncAt: sql`now()`,
                lastSuccessAt: sql`now()`,
              },
        )
        .where(eq(integrations.id, integrationId));
      this.logger.info(
        {
          integrationId,
          provider: claimed.provider,
          trigger,
          status: outcome.status,
          pulled: outcome.pulled,
          pushed: outcome.pushed,
          conflicts: outcome.conflicts,
          error: outcome.error,
        },
        'stock sync finished',
      );
      const { changes: _changes, ...rest } = outcome;
      return { runId: run!.id, ...rest };
    } finally {
      await this.db
        .update(integrations)
        .set({ syncStartedAt: null })
        .where(eq(integrations.id, integrationId));
    }
  }

  /** Old log entries are dropped; the log is for recent troubleshooting. */
  async pruneRuns(): Promise<void> {
    await this.db
      .delete(syncRuns)
      .where(sql`${syncRuns.startedAt} < now() - ${sql.raw(`interval '${RUN_RETENTION}'`)}`);
  }

  /** Integrations due for a scheduled sync: enabled and with linked goods. */
  async dueIntegrations(): Promise<string[]> {
    const rows = await this.db.execute<{ id: string }>(sql`
      select i.id from integrations i
      where coalesce((i.settings->>'syncEnabled')::boolean, true)
        and exists (select 1 from external_listings el where el.integration_id = i.id)
        and (i.provider = 'KASPI_XML'
             or exists (select 1 from integration_credentials c where c.integration_id = i.id))`);
    return rows.rows.map((row) => row.id);
  }

  private async execute(
    integration: typeof integrations.$inferSelect,
    runId: string,
  ): Promise<Omit<SyncOutcome, 'runId'> & { changes: SyncChange[] }> {
    const changes: SyncChange[] = [];
    const result = { pulled: 0, pushed: 0, conflicts: 0, error: null as string | null, changes };
    const listings = await this.db
      .select({
        variantId: externalListings.variantId,
        externalProductId: externalListings.externalProductId,
        externalSizeId: externalListings.externalSizeId,
        lastExternalStock: externalListings.lastExternalStock,
        productId: products.id,
        productStatus: products.status,
        flagReason: products.flagReason,
        title: products.title,
        size: sizeValues.code,
        externalPrice: productVariants.externalPrice,
        locationId: inventory.locationId,
        quantity: inventory.quantity,
        reserved: inventory.reserved,
      })
      .from(externalListings)
      .innerJoin(productVariants, eq(productVariants.id, externalListings.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(sizeValues, eq(sizeValues.id, productVariants.sizeValueId))
      .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
      .where(eq(externalListings.integrationId, integration.id));
    if (listings.length === 0) return { status: 'SUCCESS', ...result };

    // 1. Read the marketplace.
    let external: Map<string, number>;
    let prices = new Map<string, number>(); // key → selling price in tiyn
    let token: string | null = null;
    try {
      if (integration.provider === 'WILDBERRIES') {
        const credentials = await this.integrationsService.wildberriesToken(integration.storeId);
        if (!credentials) return { status: 'FAILED', ...result, error: 'wb.notConnected' };
        token = credentials.token;
        const chrtIds = listings
          .map((listing) => Number(listing.externalSizeId))
          .filter((id) => Number.isInteger(id));
        const amounts = await this.wildberries.stocks(
          token,
          chrtIds,
          integration.settings.warehouseId ?? null,
        );
        external = new Map([...amounts].map(([chrtId, amount]) => [String(chrtId), amount]));
        const wbPrices = await this.wildberries.listPrices(token).catch((error: unknown) => {
          if (error instanceof WildberriesError && error.code === 'wb.forbidden') return null;
          throw error;
        });
        for (const [nmId, price] of wbPrices ?? []) {
          if (price.currency === 'KZT')
            prices.set(String(nmId), Math.round(price.discountedPrice) * 100);
        }
      } else {
        if (!integration.settings.url) return { status: 'FAILED', ...result, error: 'url.invalid' };
        const { body } = await safeFetch(integration.settings.url, {
          maxBytes: KASPI_MAX_BYTES,
          timeoutMs: 30_000,
          allowPrivate: this.env.IMPORT_ALLOW_PRIVATE_HOSTS,
          accept: 'application/xml,text/xml',
        });
        const offers = kaspiStock(body);
        external = new Map([...offers].map(([sku, offer]) => [sku, offer.stock]));
        prices = new Map(
          [...offers].flatMap(([sku, offer]) =>
            offer.price ? [[sku, offer.price] as [string, number]] : [],
          ),
        );
      }
    } catch (error) {
      const code = errorCode(error);
      if (!code) throw error;
      return { status: 'FAILED', ...result, error: code };
    }

    // 2. Apply what changed there since the last sync.
    const ref = { refType: 'sync_run', refId: runId };
    const available = new Map<string, number>();
    const nextLast = new Map<string, number | null>();
    for (const listing of listings) {
      const key = listing.externalSizeId ?? '';
      const describe = { variantId: listing.variantId, title: listing.title, size: listing.size };
      available.set(listing.variantId, (listing.quantity ?? 0) - (listing.reserved ?? 0));
      if (!external.has(key)) {
        nextLast.set(listing.variantId, listing.lastExternalStock);
        continue;
      }
      const now = external.get(key)!;
      nextLast.set(listing.variantId, now);
      const delta = listing.lastExternalStock === null ? 0 : now - listing.lastExternalStock;
      if (delta === 0 || !listing.locationId) continue;
      const applied = await applySyncDelta(
        this.db,
        { variantId: listing.variantId, locationId: listing.locationId, delta },
        ref,
      );
      if (!applied) continue;
      available.set(listing.variantId, applied.available);
      if (applied.after !== applied.before) {
        result.pulled += 1;
        changes.push({ kind: 'pull', ...describe, from: applied.before, to: applied.after });
      }
      if (applied.clamped) {
        result.conflicts += 1;
        changes.push({
          kind: 'conflict',
          ...describe,
          from: applied.before + delta,
          to: applied.after,
        });
      }
    }

    // 3. Write our stock back to WB.
    const warehouseId = integration.settings.warehouseId;
    if (
      integration.provider === 'WILDBERRIES' &&
      integration.settings.pushStock &&
      warehouseId != null &&
      token
    ) {
      const outgoing = listings.flatMap((listing) => {
        const chrtId = Number(listing.externalSizeId);
        const amount = Math.max(0, available.get(listing.variantId) ?? 0);
        const current = external.get(listing.externalSizeId ?? '');
        return Number.isInteger(chrtId) && current !== amount
          ? [{ listing, chrtId, amount, current: current ?? null }]
          : [];
      });
      if (outgoing.length) {
        try {
          await this.wildberries.setStocks(
            token,
            warehouseId,
            outgoing.map(({ chrtId, amount }) => ({ chrtId, amount })),
          );
          for (const { listing, amount, current } of outgoing) {
            nextLast.set(listing.variantId, amount);
            result.pushed += 1;
            changes.push({
              kind: 'push',
              variantId: listing.variantId,
              title: listing.title,
              size: listing.size,
              from: current,
              to: amount,
            });
          }
        } catch (error) {
          if (!(error instanceof WildberriesError)) throw error;
          result.error =
            error.code === 'wb.forbidden' || error.code === 'wb.invalidToken'
              ? 'wb.pushForbidden'
              : error.code;
        }
      }
    }

    // 4. Remember what the marketplace shows now.
    for (const listing of listings) {
      await this.db
        .update(externalListings)
        .set({
          lastExternalStock: nextLast.get(listing.variantId) ?? null,
          lastSyncedAt: sql`now()`,
        })
        .where(eq(externalListings.variantId, listing.variantId));
    }

    // 5. Marketplace prices: the discount is always measured from the real selling price.
    await this.refreshPrices(integration.provider, listings, prices, changes);

    return {
      status: result.error || result.conflicts ? 'PARTIAL' : 'SUCCESS',
      ...result,
    };
  }

  private async refreshPrices(
    provider: 'WILDBERRIES' | 'KASPI_XML',
    listings: {
      variantId: string;
      externalProductId: string;
      externalSizeId: string | null;
      productId: string;
      externalPrice: number | null;
      title: string;
      size: string | null;
    }[],
    prices: Map<string, number>,
    changes: SyncChange[],
  ): Promise<void> {
    if (prices.size === 0) return;
    const [setting] = await this.db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, 'catalog.min_discount_percent'));
    const minDiscount = Number(setting?.value ?? 30);
    const tooSmall = new Set<string>();
    for (const listing of listings) {
      const key = provider === 'WILDBERRIES' ? listing.externalProductId : listing.externalSizeId;
      const price = key ? prices.get(key) : undefined;
      if (price === undefined || price <= 0 || price === listing.externalPrice) continue;
      const [updated] = await this.db
        .update(productVariants)
        .set({ externalPrice: price })
        .where(eq(productVariants.id, listing.variantId))
        .returning({ discount: productVariants.discountPercent });
      changes.push({
        kind: 'price',
        variantId: listing.variantId,
        title: listing.title,
        size: listing.size,
        from: listing.externalPrice,
        to: price,
      });
      if ((updated?.discount ?? 0) < minDiscount) tooSmall.add(listing.productId);
    }
    if (tooSmall.size === 0) return;
    const reason = 'discount.externalPriceDropped';
    await this.db.execute(sql`
      update products set
        status = 'FLAGGED',
        flag_reason = case
          when flag_reason is null or flag_reason = '' then ${reason}
          when position(${reason} in flag_reason) > 0 then flag_reason
          else flag_reason || ',' || ${reason} end
      where id in (${sql.join(
        [...tooSmall].map((id) => sql`${id}::uuid`),
        sql`, `,
      )}) and status in ('ACTIVE', 'FLAGGED')`);
  }
}
