import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ImportJob,
  ImportJobList,
  ImportMappingRequest,
  ImportPublishResult,
  ImportRow,
  ImportRowPage,
  ImportRowStatus,
  UpdateImportRowRequest,
} from '@lastsize/contracts';
import {
  and,
  asc,
  categories,
  colors,
  type Database,
  desc,
  eq,
  externalListings,
  importJobs,
  importMappings,
  importRows,
  inArray,
  platformSettings,
  products,
  productVariants,
  sizeCharts,
  sizeValues,
  sql,
  storeMedia,
  stores,
  type Transaction,
} from '@lastsize/db';
import { salePriceFromPercent } from '@lastsize/domain';
import type { Logger } from '@lastsize/logger';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { API_ENV, type ApiEnv } from '../config/api-env';
import { DATABASE } from '../infrastructure/infrastructure.module';
import { APP_LOGGER } from '../logging';
import { ImageRejectedError } from '../media/image-processor';
import { MediaService, toMedia } from '../media/media.service';
import { ProductsService } from '../products/products.service';
import { ValidationFailedException } from '../security/zod-validation.pipe';
import {
  type ImportCandidate,
  MAX_IMPORT_ROWS,
  MAX_PHOTOS,
  SourceRejectedError,
} from './candidate';
import { parseImportFile } from './import-file';
import {
  type CatalogContext,
  type ChartCode,
  chartFor,
  evaluateRow,
  initialGuesses,
  mappingKey,
  type RowState,
  rowDiscount,
  sizeKey,
  variantsOf,
} from './import-rules';
import { IntegrationsService, wildberriesFailure } from './integrations.service';
import { parseKaspiXml } from './kaspi-xml';
import { FetchRejectedError, safeFetch } from './safe-fetch';
import { WILDBERRIES_API, type WildberriesApi, WildberriesError } from './wildberries.client';
import { wildberriesCandidates } from './wildberries-source';

type Actor = { userId: string; request: FastifyRequest };
type Source = 'WILDBERRIES' | 'KASPI_XML' | 'FILE';
type Row = typeof importRows.$inferSelect;

/** Rows a seller can no longer change. */
const FINAL: ImportRowStatus[] = ['PUBLISHING', 'PUBLISHED', 'SKIPPED'];
/** Rows per publish request; each may download up to 10 photos, so batches stay small. */
const PUBLISH_BATCH = 2;
const PHOTO_CONCURRENCY = 3;
const KASPI_MAX_BYTES = 20 * 1024 * 1024;
const PHOTO_MAX_BYTES = 15 * 1024 * 1024;

function rejectSource(error: unknown, path: string): never {
  if (error instanceof SourceRejectedError || error instanceof FetchRejectedError)
    throw new ValidationFailedException([{ path, message: error.code }]);
  throw error;
}

function stateOf(row: Row): RowState {
  return {
    data: row.data,
    categoryId: row.categoryId,
    gender: row.gender,
    colorId: row.colorId,
    sizeMap: row.sizeMap,
    mediaIds: row.mediaIds,
    originalPrice: row.originalPrice,
    salePrice: row.salePrice,
    externalPrice: row.externalPrice,
  };
}

@Injectable()
export class ImportsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    @Inject(WILDBERRIES_API) private readonly wildberries: WildberriesApi,
    private readonly integrations: IntegrationsService,
    private readonly media: MediaService,
    private readonly products: ProductsService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────── creating a job ─────────────────────────

  async createFromWildberries(storeId: string, actor: Actor): Promise<string> {
    const credentials = await this.integrations.wildberriesToken(storeId);
    if (!credentials) throw new ConflictException('Сначала подключите Wildberries');
    const warnings: string[] = [];
    const optional = <T>(promise: Promise<T>, fallback: T, warning: string) =>
      promise.catch((error: unknown) => {
        if (error instanceof WildberriesError && error.code === 'wb.forbidden') {
          warnings.push(warning);
          return fallback;
        }
        throw error;
      });

    let candidates: ImportCandidate[];
    try {
      const cards = await this.wildberries.listCards(credentials.token, MAX_IMPORT_ROWS);
      const prices = await optional(
        this.wildberries.listPrices(credentials.token),
        new Map(),
        'wb.noPriceAccess',
      );
      const stocks = await optional(
        this.wildberries.stocks(
          credentials.token,
          cards.flatMap((card) => (card.sizes ?? []).map((size) => size.chrtID)),
        ),
        new Map(),
        'wb.noStockAccess',
      );
      if ([...prices.values()].some((price) => price.currency !== 'KZT'))
        warnings.push('wb.pricesNotInTenge');
      candidates = wildberriesCandidates(cards, prices, stocks);
    } catch (error) {
      if (error instanceof WildberriesError)
        await this.integrations.recordOutcome(credentials.integrationId, error.code);
      return wildberriesFailure(error);
    }
    await this.integrations.recordOutcome(credentials.integrationId, null);
    if (candidates.length === 0) rejectSource(new SourceRejectedError('source.empty'), 'source');
    return this.createJob(storeId, 'WILDBERRIES', candidates, warnings, actor);
  }

  async createFromKaspi(storeId: string, url: string, actor: Actor): Promise<string> {
    let candidates: ImportCandidate[];
    try {
      const { body } = await safeFetch(url, {
        maxBytes: KASPI_MAX_BYTES,
        timeoutMs: 30_000,
        allowPrivate: this.env.IMPORT_ALLOW_PRIVATE_HOSTS,
        accept: 'application/xml,text/xml',
      });
      candidates = parseKaspiXml(body);
    } catch (error) {
      rejectSource(error, 'url');
    }
    const integrationId = await this.integrations.rememberKaspiUrl(storeId, url);
    await this.integrations.recordOutcome(integrationId, null);
    return this.createJob(storeId, 'KASPI_XML', candidates, ['kaspi.noPhotos'], actor);
  }

  async createFromFile(storeId: string, file: Buffer, actor: Actor): Promise<string> {
    const candidates = await parseImportFile(file).catch((error: unknown) =>
      rejectSource(error, 'file'),
    );
    return this.createJob(storeId, 'FILE', candidates, [], actor);
  }

  private async createJob(
    storeId: string,
    source: Source,
    candidates: ImportCandidate[],
    warnings: string[],
    actor: Actor,
  ): Promise<string> {
    const context = await this.context(storeId);
    // Goods already brought over from this source are listed but not imported twice.
    const imported = new Set(
      (
        await this.db
          .select({ externalId: importRows.externalId })
          .from(importRows)
          .innerJoin(importJobs, eq(importJobs.id, importRows.jobId))
          .innerJoin(products, eq(products.id, importRows.productId))
          .where(
            and(
              eq(importJobs.storeId, storeId),
              eq(importJobs.source, source),
              eq(importRows.status, 'PUBLISHED'),
            ),
          )
      ).map((row) => row.externalId),
    );

    const jobId = await this.db.transaction(async (tx) => {
      const [job] = await tx
        .insert(importJobs)
        .values({ storeId, source, createdBy: actor.userId, warnings })
        .returning({ id: importJobs.id });
      const rows = candidates.map((candidate, position) => {
        const state: RowState = {
          data: candidate.data,
          ...initialGuesses(context, candidate.data),
          sizeMap: {},
          mediaIds: [],
          originalPrice: candidate.originalPrice,
          salePrice: candidate.salePrice,
          externalPrice: candidate.externalPrice,
        };
        const evaluated = evaluateRow(context, state);
        const skipped = imported.has(candidate.externalId);
        return {
          jobId: job!.id,
          position,
          externalId: candidate.externalId,
          data: state.data,
          categoryId: state.categoryId,
          gender: state.gender,
          colorId: state.colorId,
          sizeMap: evaluated.sizeMap,
          selected: !skipped,
          originalPrice: state.originalPrice,
          salePrice: state.salePrice,
          externalPrice: state.externalPrice,
          status: (skipped
            ? 'SKIPPED'
            : evaluated.issues.length
              ? 'NEEDS_ATTENTION'
              : 'READY') as ImportRowStatus,
          issues: skipped ? ['import.alreadyImported'] : evaluated.issues,
        };
      });
      for (let i = 0; i < rows.length; i += 500) {
        await tx.insert(importRows).values(rows.slice(i, i + 500));
      }
      return job!.id;
    });

    await this.audit.record(
      {
        action: 'import.created',
        actorType: 'USER',
        actorId: actor.userId,
        entityType: 'store',
        entityId: storeId,
        metadata: { source, jobId, rows: candidates.length },
      },
      actor.request,
    );
    return jobId;
  }

  // ───────────────────────── reading ─────────────────────────

  async listJobs(storeId: string): Promise<ImportJobList> {
    const jobs = await this.db
      .select({ id: importJobs.id, source: importJobs.source, createdAt: importJobs.createdAt })
      .from(importJobs)
      .where(eq(importJobs.storeId, storeId))
      .orderBy(desc(importJobs.createdAt))
      .limit(20);
    const counts = await this.counts(jobs.map((job) => job.id));
    return jobs.map((job) => ({
      ...job,
      createdAt: job.createdAt.toISOString(),
      counts: counts.get(job.id) ?? this.emptyCounts(),
    }));
  }

  async job(storeId: string, jobId: string): Promise<ImportJob> {
    const job = await this.jobOf(this.db, storeId, jobId);
    const context = await this.context(storeId);
    const rows = await this.db
      .select()
      .from(importRows)
      .where(
        and(eq(importRows.jobId, jobId), sql`${importRows.status} not in ('PUBLISHED', 'SKIPPED')`),
      );

    const tally = (map: Map<string, number>, value: string | null) => {
      if (value) map.set(value, (map.get(value) ?? 0) + 1);
    };
    const categoryValues = new Map<string, number>();
    const colorValues = new Map<string, number>();
    const sizeValuesByChart = new Map<string, number>();
    for (const row of rows) {
      if (row.categoryId === null) tally(categoryValues, row.data.sourceCategory);
      if (row.colorId === null) tally(colorValues, row.data.sourceColor);
      const chart = chartFor(context, row.categoryId, row.gender);
      if (!chart) continue;
      for (const size of row.data.sizes) {
        if (size.label && row.sizeMap[sizeKey(size.label)] == null)
          tally(sizeValuesByChart, `${chart}\u0000${size.label}`);
      }
    }
    const top = (map: Map<string, number>) =>
      [...map]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 50)
        .map(([value, count]) => ({ value, count }));

    return {
      id: job.id,
      source: job.source,
      createdAt: job.createdAt.toISOString(),
      warnings: job.warnings,
      counts: (await this.counts([jobId])).get(jobId) ?? this.emptyCounts(),
      unmapped: {
        categories: top(categoryValues),
        colors: top(colorValues),
        sizes: top(sizeValuesByChart).map(({ value, count }) => {
          const [chart, label] = value.split('\u0000') as [ChartCode, string];
          return { chart, value: label, count };
        }),
        missingGender: rows.filter((row) => row.gender === null).length,
      },
    };
  }

  async rows(
    storeId: string,
    jobId: string,
    filter: 'all' | 'attention' | 'ready' | 'published' | 'failed',
    limit: number,
    offset: number,
  ): Promise<ImportRowPage> {
    await this.jobOf(this.db, storeId, jobId);
    const statuses: Record<typeof filter, ImportRowStatus[] | null> = {
      all: null,
      attention: ['NEEDS_ATTENTION'],
      ready: ['READY', 'PUBLISHING'],
      published: ['PUBLISHED'],
      failed: ['FAILED'],
    };
    const wanted = statuses[filter];
    const where = and(
      eq(importRows.jobId, jobId),
      wanted ? inArray(importRows.status, wanted) : undefined,
    );
    const [rows, [{ total } = { total: 0 }]] = await Promise.all([
      this.db
        .select()
        .from(importRows)
        .where(where)
        .orderBy(asc(importRows.position))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(importRows)
        .where(where),
    ]);
    const context = await this.context(storeId);
    const images = await this.mediaFor(
      storeId,
      rows.flatMap((row) => row.mediaIds),
    );
    return { items: rows.map((row) => this.toDto(context, row, images)), total };
  }

  // ───────────────────────── editing ─────────────────────────

  async updateRow(
    storeId: string,
    jobId: string,
    rowId: string,
    patch: UpdateImportRowRequest,
  ): Promise<ImportRow> {
    const context = await this.context(storeId);
    if (patch.categoryId !== undefined && !context.categories.get(patch.categoryId)?.usable)
      throw new ValidationFailedException([{ path: 'categoryId', message: 'category.invalid' }]);
    if (patch.colorId !== undefined && !context.colorIds.has(patch.colorId))
      throw new ValidationFailedException([{ path: 'colorId', message: 'color.invalid' }]);
    if (patch.mediaIds?.length) {
      if (new Set(patch.mediaIds).size !== patch.mediaIds.length)
        throw new ValidationFailedException([{ path: 'mediaIds', message: 'images.duplicate' }]);
      const found = await this.mediaFor(storeId, patch.mediaIds);
      if (found.size !== patch.mediaIds.length)
        throw new ValidationFailedException([{ path: 'mediaIds', message: 'images.notFound' }]);
    }

    const updated = await this.db.transaction(async (tx) => {
      await this.jobOf(tx, storeId, jobId);
      const [row] = await tx
        .select()
        .from(importRows)
        .where(and(eq(importRows.id, rowId), eq(importRows.jobId, jobId)))
        .for('update');
      if (!row) throw new NotFoundException('Строка импорта не найдена');
      if (FINAL.includes(row.status)) throw new ConflictException('Эта строка уже обработана');

      const state = stateOf(row);
      const data = structuredClone(row.data);
      const sizeMap = { ...row.sizeMap };
      if (patch.title !== undefined) data.title = patch.title;
      if (patch.brand !== undefined) data.brand = patch.brand;
      if (patch.sizes !== undefined) {
        if (patch.sizes.length !== data.sizes.length)
          throw new ValidationFailedException([{ path: 'sizes', message: 'sizes.mismatch' }]);
        patch.sizes.forEach((size, index) => {
          const target = data.sizes[index]!;
          target.quantity = size.quantity;
          sizeMap[sizeKey(target.label)] = size.sizeValueId;
        });
      }
      const next: RowState = {
        ...state,
        data,
        sizeMap,
        categoryId: patch.categoryId ?? state.categoryId,
        gender: patch.gender ?? state.gender,
        colorId: patch.colorId ?? state.colorId,
        mediaIds: patch.mediaIds ?? state.mediaIds,
        originalPrice: patch.originalPrice ?? state.originalPrice,
        salePrice: patch.salePrice ?? state.salePrice,
      };
      return this.save(tx, row, next, context, patch.selected);
    });
    const images = await this.mediaFor(storeId, updated.mediaIds);
    return this.toDto(context, updated, images);
  }

  /** Remembers a match for the store and applies it to every open row of the job. */
  async remember(storeId: string, jobId: string, mapping: ImportMappingRequest): Promise<void> {
    const context = await this.context(storeId);
    const sourceValue = mapping.sourceValue.trim();
    if (mapping.kind === 'CATEGORY' && !context.categories.get(mapping.targetId)?.usable)
      throw new ValidationFailedException([{ path: 'targetId', message: 'category.invalid' }]);
    if (mapping.kind === 'COLOR' && !context.colorIds.has(mapping.targetId))
      throw new ValidationFailedException([{ path: 'targetId', message: 'color.invalid' }]);
    if (
      mapping.kind === 'SIZE' &&
      !context.charts.get(mapping.chart)?.some((value) => value.id === mapping.targetId)
    )
      throw new ValidationFailedException([{ path: 'targetId', message: 'sizes.wrongChart' }]);

    const stored = mapping.kind === 'SIZE' ? `${mapping.chart}:${sourceValue}` : sourceValue;
    await this.db
      .insert(importMappings)
      .values({ storeId, kind: mapping.kind, sourceValue: stored, targetId: mapping.targetId })
      .onConflictDoUpdate({
        target: [importMappings.storeId, importMappings.kind, importMappings.sourceValue],
        set: { targetId: mapping.targetId },
      });
    const key = mappingKey(
      mapping.kind,
      sourceValue,
      mapping.kind === 'SIZE' ? mapping.chart : undefined,
    );
    context.mappings.set(key, mapping.targetId);

    const same = (value: string | null) =>
      value !== null && value.trim().toLowerCase() === sourceValue.toLowerCase();
    await this.rewrite(storeId, jobId, context, (state) => {
      if (mapping.kind === 'CATEGORY' && same(state.data.sourceCategory))
        state.categoryId = mapping.targetId;
      if (mapping.kind === 'COLOR' && same(state.data.sourceColor))
        state.colorId = mapping.targetId;
      if (
        mapping.kind === 'SIZE' &&
        chartFor(context, state.categoryId, state.gender) === mapping.chart
      ) {
        for (const size of state.data.sizes)
          if (same(size.label)) state.sizeMap[sizeKey(size.label)] = mapping.targetId;
      }
    });
  }

  /** Fills a value into every open row that has none yet ("all of these are women's"). */
  async fill(
    storeId: string,
    jobId: string,
    values: { gender?: RowState['gender']; categoryId?: number; colorId?: number },
  ): Promise<void> {
    const context = await this.context(storeId);
    if (values.categoryId !== undefined && !context.categories.get(values.categoryId)?.usable)
      throw new ValidationFailedException([{ path: 'categoryId', message: 'category.invalid' }]);
    if (values.colorId !== undefined && !context.colorIds.has(values.colorId))
      throw new ValidationFailedException([{ path: 'colorId', message: 'color.invalid' }]);
    await this.rewrite(storeId, jobId, context, (state) => {
      if (values.gender && !state.gender) state.gender = values.gender;
      if (values.categoryId && state.categoryId === null) state.categoryId = values.categoryId;
      if (values.colorId && state.colorId === null) state.colorId = values.colorId;
    });
  }

  /** Sale price = marketplace price (or the price before discount) minus `percent`, for selected rows. */
  async setPrices(storeId: string, jobId: string, percent: number): Promise<void> {
    const context = await this.context(storeId);
    await this.rewrite(storeId, jobId, context, (state, row) => {
      if (!row.selected) return;
      const base = state.externalPrice ?? state.originalPrice;
      if (base === null) return;
      state.originalPrice ??= base;
      state.salePrice = salePriceFromPercent(base, percent);
    });
  }

  async select(storeId: string, jobId: string, selected: boolean): Promise<void> {
    await this.jobOf(this.db, storeId, jobId);
    await this.db
      .update(importRows)
      .set({ selected })
      .where(
        and(
          eq(importRows.jobId, jobId),
          sql`${importRows.status} not in ('PUBLISHING', 'PUBLISHED', 'SKIPPED')`,
        ),
      );
  }

  // ───────────────────────── publishing ─────────────────────────

  /**
   * Publishes the next few ready rows. Rows are claimed atomically (PUBLISHING), so two tabs
   * or a double click never create the same product twice; the client calls again until
   * `remaining` is 0.
   */
  async publish(
    storeId: string,
    jobId: string,
    mode: 'publish' | 'draft',
    actor: Actor,
  ): Promise<ImportPublishResult> {
    const job = await this.jobOf(this.db, storeId, jobId);
    if (mode === 'publish') {
      const [store] = await this.db
        .select({ status: stores.status })
        .from(stores)
        .where(eq(stores.id, storeId));
      if (store?.status !== 'VERIFIED')
        throw new ValidationFailedException([{ path: 'mode', message: 'store.notVerified' }]);
    }
    // Rows left behind by a crashed request go back to the queue.
    await this.db
      .update(importRows)
      .set({ status: 'READY' })
      .where(
        and(
          eq(importRows.jobId, jobId),
          eq(importRows.status, 'PUBLISHING'),
          sql`${importRows.updatedAt} < now() - interval '10 minutes'`,
        ),
      );
    const claimed = await this.db.execute<{ id: string }>(sql`
      update import_rows set status = 'PUBLISHING'
      where id in (
        select id from import_rows
        where job_id = ${jobId} and status = 'READY' and selected
        order by position
        limit ${PUBLISH_BATCH}
        for update skip locked
      )
      returning id`);
    const ids = claimed.rows.map((row) => row.id);
    const rows = ids.length
      ? await this.db
          .select()
          .from(importRows)
          .where(inArray(importRows.id, ids))
          .orderBy(asc(importRows.position))
      : [];

    const context = await this.context(storeId);
    const integrationId =
      job.source === 'FILE' ? null : await this.integrations.integrationId(storeId, job.source);
    const processed: ImportPublishResult['processed'] = [];
    for (const row of rows) {
      const result = await this.publishRow(storeId, row, context, mode, integrationId, actor);
      await this.db
        .update(importRows)
        .set({ status: result.status, issues: result.issues, productId: result.productId })
        .where(eq(importRows.id, row.id));
      processed.push({ rowId: row.id, ...result });
    }

    const [{ remaining } = { remaining: 0 }] = await this.db
      .select({ remaining: sql<number>`count(*)::int` })
      .from(importRows)
      .where(
        and(
          eq(importRows.jobId, jobId),
          inArray(importRows.status, ['READY', 'PUBLISHING']),
          eq(importRows.selected, true),
        ),
      );
    return { processed, remaining };
  }

  private async publishRow(
    storeId: string,
    row: Row,
    context: CatalogContext,
    mode: 'publish' | 'draft',
    integrationId: string | null,
    actor: Actor,
  ): Promise<{ status: ImportRowStatus; issues: string[]; productId: string | null }> {
    const state = stateOf(row);
    const evaluated = evaluateRow(context, state);
    if (evaluated.issues.length)
      return { status: 'NEEDS_ATTENTION', issues: evaluated.issues, productId: null };

    try {
      let mediaIds = state.mediaIds;
      if (mediaIds.length === 0) {
        mediaIds = await this.downloadPhotos(storeId, actor.userId, state.data.photos);
        if (mediaIds.length === 0)
          return { status: 'FAILED', issues: ['images.downloadFailed'], productId: null };
        await this.db.update(importRows).set({ mediaIds }).where(eq(importRows.id, row.id));
      }
      const variants = variantsOf({ ...state, sizeMap: evaluated.sizeMap }, evaluated.chart);
      const productId = await this.products.create(
        storeId,
        {
          title: state.data.title,
          brand: state.data.brand!,
          categoryId: state.categoryId!,
          gender: state.gender!,
          colorId: state.colorId!,
          description: state.data.description ?? undefined,
          composition: state.data.composition ?? undefined,
          article: state.data.article ?? undefined,
          mediaIds,
          originalPrice: state.originalPrice!,
          salePrice: state.salePrice!,
          externalPrice: state.externalPrice,
          variants: variants.map(({ sizeValueId, quantity }) => ({ sizeValueId, quantity })),
          publish: mode === 'publish',
        },
        actor,
      );
      if (integrationId)
        await this.linkListings(productId, integrationId, row.externalId, variants);
      return { status: 'PUBLISHED', issues: [], productId };
    } catch (error) {
      if (error instanceof ValidationFailedException)
        return {
          status: 'FAILED',
          issues: [...new Set(error.errors.map((issue) => issue.message))],
          productId: null,
        };
      this.logger.error({ err: error, importRowId: row.id }, 'import row failed');
      return { status: 'FAILED', issues: ['import.failed'], productId: null };
    }
  }

  /** Photos that cannot be downloaded or are not real images are skipped, order is kept. */
  private async downloadPhotos(storeId: string, userId: string, urls: string[]): Promise<string[]> {
    const results: (string | null)[] = Array.from(
      { length: Math.min(urls.length, MAX_PHOTOS) },
      () => null,
    );
    let next = 0;
    const worker = async () => {
      while (next < results.length) {
        const index = next++;
        try {
          const { body } = await safeFetch(urls[index]!, {
            maxBytes: PHOTO_MAX_BYTES,
            timeoutMs: 20_000,
            allowPrivate: this.env.IMPORT_ALLOW_PRIVATE_HOSTS,
            accept: 'image/*',
          });
          results[index] = (await this.media.upload(storeId, userId, body)).id;
        } catch (error) {
          if (error instanceof FetchRejectedError || error instanceof ImageRejectedError) continue;
          throw error;
        }
      }
    };
    await Promise.all(Array.from({ length: PHOTO_CONCURRENCY }, worker));
    return results.filter((id): id is string => id !== null);
  }

  /** Remembers which marketplace size each new variant came from (for stock sync). */
  private async linkListings(
    productId: string,
    integrationId: string,
    externalProductId: string,
    variants: ReturnType<typeof variantsOf>,
  ): Promise<void> {
    const created = await this.db
      .select({ id: productVariants.id, sizeValueId: productVariants.sizeValueId })
      .from(productVariants)
      .where(eq(productVariants.productId, productId));
    const values = created.flatMap((variant) => {
      const source = variants.find((v) => v.sizeValueId === variant.sizeValueId);
      return source
        ? [
            {
              variantId: variant.id,
              integrationId,
              externalProductId,
              externalSizeId: source.externalSizeId,
              barcode: source.barcode,
              lastExternalStock: source.externalQuantity,
            },
          ]
        : [];
    });
    if (values.length) await this.db.insert(externalListings).values(values).onConflictDoNothing();
  }

  // ───────────────────────── internals ─────────────────────────

  private async jobOf(executor: Database | Transaction, storeId: string, jobId: string) {
    const [job] = await executor
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.id, jobId), eq(importJobs.storeId, storeId)));
    if (!job) throw new NotFoundException('Импорт не найден');
    return job;
  }

  /** Applies `mutate` to every open row of the job, re-checks them and saves what changed. */
  private async rewrite(
    storeId: string,
    jobId: string,
    context: CatalogContext,
    mutate: (state: RowState, row: Row) => void,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.jobOf(tx, storeId, jobId);
      const rows = await tx
        .select()
        .from(importRows)
        .where(
          and(
            eq(importRows.jobId, jobId),
            sql`${importRows.status} not in ('PUBLISHING', 'PUBLISHED', 'SKIPPED')`,
          ),
        )
        .for('update');
      for (const row of rows) {
        const state = stateOf(row);
        state.sizeMap = { ...state.sizeMap };
        mutate(state, row);
        await this.save(tx, row, state, context, undefined, true);
      }
    });
  }

  private async save(
    tx: Transaction,
    row: Row,
    state: RowState,
    context: CatalogContext,
    selected: boolean | undefined,
    onlyIfChanged = false,
  ): Promise<Row> {
    const evaluated = evaluateRow(context, state);
    const values = {
      data: state.data,
      categoryId: state.categoryId,
      gender: state.gender,
      colorId: state.colorId,
      sizeMap: evaluated.sizeMap,
      mediaIds: state.mediaIds,
      originalPrice: state.originalPrice,
      salePrice: state.salePrice,
      selected: selected ?? row.selected,
      status: (evaluated.issues.length ? 'NEEDS_ATTENTION' : 'READY') as ImportRowStatus,
      issues: evaluated.issues,
    };
    if (onlyIfChanged) {
      const before = JSON.stringify([
        row.data,
        row.categoryId,
        row.gender,
        row.colorId,
        row.sizeMap,
        row.mediaIds,
        row.originalPrice,
        row.salePrice,
        row.selected,
        row.status,
        row.issues,
      ]);
      const after = JSON.stringify([
        values.data,
        values.categoryId,
        values.gender,
        values.colorId,
        values.sizeMap,
        values.mediaIds,
        values.originalPrice,
        values.salePrice,
        values.selected,
        values.status,
        values.issues,
      ]);
      if (before === after) return row;
    }
    const [updated] = await tx
      .update(importRows)
      .set(values)
      .where(eq(importRows.id, row.id))
      .returning();
    return updated!;
  }

  private async context(storeId: string): Promise<CatalogContext> {
    const [categoryRows, chartRows, valueRows, colorRows, settingRows, mappingRows] =
      await Promise.all([
        this.db
          .select({
            id: categories.id,
            parentId: categories.parentId,
            slug: categories.slug,
            isActive: categories.isActive,
            sizeChartId: categories.sizeChartId,
          })
          .from(categories),
        this.db.select({ id: sizeCharts.id, code: sizeCharts.code }).from(sizeCharts),
        this.db
          .select({ id: sizeValues.id, chartId: sizeValues.chartId, code: sizeValues.code })
          .from(sizeValues)
          .orderBy(asc(sizeValues.position)),
        this.db.select({ id: colors.id, code: colors.code }).from(colors),
        this.db
          .select({ value: platformSettings.value })
          .from(platformSettings)
          .where(eq(platformSettings.key, 'catalog.min_discount_percent')),
        this.db
          .select({
            kind: importMappings.kind,
            sourceValue: importMappings.sourceValue,
            targetId: importMappings.targetId,
          })
          .from(importMappings)
          .where(eq(importMappings.storeId, storeId)),
      ]);
    const chartCode = new Map(chartRows.map((chart) => [chart.id, chart.code as ChartCode]));
    const bySlug = new Map(categoryRows.map((row) => [row.id, row]));
    const parents = new Set(categoryRows.map((row) => row.parentId).filter((id) => id !== null));
    const context: CatalogContext = {
      categories: new Map(
        categoryRows.map((row) => [
          row.id,
          {
            slug: row.slug,
            rootSlug: row.parentId ? (bySlug.get(row.parentId)?.slug ?? row.slug) : row.slug,
            chart: row.sizeChartId ? (chartCode.get(row.sizeChartId) ?? null) : null,
            usable: row.isActive && !parents.has(row.id),
          },
        ]),
      ),
      categoryBySlug: new Map(categoryRows.map((row) => [row.slug, row.id])),
      colorByCode: new Map(colorRows.map((row) => [row.code, row.id])),
      colorIds: new Set(colorRows.map((row) => row.id)),
      charts: new Map(),
      minDiscount: Number(settingRows[0]?.value ?? 30),
      mappings: new Map(),
    };
    for (const value of valueRows) {
      const code = chartCode.get(value.chartId);
      if (!code) continue;
      const list = context.charts.get(code) ?? [];
      list.push({ id: value.id, code: value.code });
      context.charts.set(code, list);
    }
    for (const mapping of mappingRows) {
      if (mapping.kind === 'SIZE') {
        const [chart, ...label] = mapping.sourceValue.split(':');
        context.mappings.set(
          mappingKey('SIZE', label.join(':'), chart as ChartCode),
          mapping.targetId,
        );
      } else {
        context.mappings.set(mappingKey(mapping.kind, mapping.sourceValue), mapping.targetId);
      }
    }
    return context;
  }

  private async mediaFor(storeId: string, ids: string[]) {
    const result = new Map<string, ReturnType<typeof toMedia>>();
    if (ids.length === 0) return result;
    const rows = await this.db
      .select({
        id: storeMedia.id,
        baseKey: storeMedia.baseKey,
        width: storeMedia.width,
        height: storeMedia.height,
      })
      .from(storeMedia)
      .where(and(eq(storeMedia.storeId, storeId), inArray(storeMedia.id, [...new Set(ids)])));
    for (const row of rows) result.set(row.id, toMedia(row));
    return result;
  }

  private toDto(
    context: CatalogContext,
    row: Row,
    images: Map<string, ReturnType<typeof toMedia>>,
  ): ImportRow {
    const chart = chartFor(context, row.categoryId, row.gender);
    return {
      id: row.id,
      position: row.position,
      externalId: row.externalId,
      title: row.data.title,
      brand: row.data.brand,
      article: row.data.article,
      sourceCategory: row.data.sourceCategory,
      sourceColor: row.data.sourceColor,
      photoCount: row.data.photos.length,
      images: row.mediaIds.flatMap((id) => images.get(id) ?? []),
      sizes: row.data.sizes.map((size) => ({
        label: size.label,
        quantity: size.quantity,
        sizeValueId: chart ? (row.sizeMap[sizeKey(size.label)] ?? null) : null,
      })),
      chart: chart ?? null,
      categoryId: row.categoryId,
      gender: row.gender,
      colorId: row.colorId,
      selected: row.selected,
      originalPrice: row.originalPrice,
      salePrice: row.salePrice,
      externalPrice: row.externalPrice,
      discountPercent: rowDiscount(row),
      status: row.status,
      issues: row.issues,
      productId: row.productId,
    };
  }

  private emptyCounts() {
    return {
      total: 0,
      ready: 0,
      needsAttention: 0,
      publishing: 0,
      published: 0,
      failed: 0,
      skipped: 0,
      toPublish: 0,
    };
  }

  private async counts(jobIds: string[]) {
    const result = new Map<string, ReturnType<ImportsService['emptyCounts']>>();
    if (jobIds.length === 0) return result;
    const rows = await this.db
      .select({
        jobId: importRows.jobId,
        status: importRows.status,
        selected: importRows.selected,
        total: sql<number>`count(*)::int`,
      })
      .from(importRows)
      .where(inArray(importRows.jobId, jobIds))
      .groupBy(importRows.jobId, importRows.status, importRows.selected);
    for (const row of rows) {
      const counts = result.get(row.jobId) ?? this.emptyCounts();
      counts.total += row.total;
      const field = {
        READY: 'ready',
        NEEDS_ATTENTION: 'needsAttention',
        PUBLISHING: 'publishing',
        PUBLISHED: 'published',
        FAILED: 'failed',
        SKIPPED: 'skipped',
      } as const;
      counts[field[row.status]] += row.total;
      if (row.selected && row.status === 'READY') counts.toPublish += row.total;
      result.set(row.jobId, counts);
    }
    return result;
  }
}
