import { randomBytes } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ProductList,
  ProductListItem,
  ProductStatus,
  SellerProduct,
} from '@lastsize/contracts';
import {
  and,
  asc,
  brands,
  categories,
  count,
  type Database,
  desc,
  eq,
  inArray,
  inventory,
  InventoryConflictError,
  referencePriceAfterChange,
  platformSettings,
  priceHistory,
  productImages,
  products,
  productVariants,
  recordPublishedPrices,
  setStockLevel,
  setVariantPrices,
  sizeCharts,
  sizeValues,
  sql,
  storeLocations,
  storeMedia,
  stores,
  type Transaction,
} from '@lastsize/db';
import {
  flagReasons,
  isPublicStatus,
  nextProductStatus,
  priceProblems,
  type ProductAction,
  productActionAllowedFrom,
  sellerCanEdit,
  slugify,
} from '@lastsize/domain';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { DATABASE } from '../infrastructure/infrastructure.module';
import { toMedia } from '../media/media.service';
import { ValidationFailedException } from '../security/zod-validation.pipe';
import { SyncScheduler } from '../sync/sync-queue';

type Gender = 'WOMEN' | 'MEN' | 'UNISEX' | 'KIDS';

export interface VariantInput {
  sizeValueId: number | null;
  quantity: number;
  sku?: string;
}

export interface ProductInput {
  title: string;
  brand: string;
  categoryId: number;
  gender: Gender;
  colorId: number;
  description?: string;
  composition?: string;
  article?: string;
  mediaIds: string[];
  originalPrice: number;
  salePrice: number;
  /** Selling price on Wildberries or Kaspi (imports only); the discount is measured from it too. */
  externalPrice?: number | null;
  variants: VariantInput[];
}

type Actor = { userId: string; request: FastifyRequest };
type Issue = { path: string; message: string };

const KIDS_HEIGHT_CHART = 'KIDS_HEIGHT';

function fail(issues: Issue[]): never {
  throw new ValidationFailedException(issues);
}

function newShortId(): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  return [...randomBytes(8)].map((byte) => alphabet[byte % alphabet.length]).join('');
}

@Injectable()
export class ProductsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly syncScheduler: SyncScheduler,
  ) {}

  // ───────────────────────── seller ─────────────────────────

  async create(
    storeId: string,
    input: ProductInput & { publish: boolean },
    actor: Actor,
  ): Promise<string> {
    const store = await this.storeForWrite(storeId);
    const sizes = await this.validateCatalogFields(input);
    await this.validateMedia(this.db, storeId, input.mediaIds);
    const minDiscount = await this.minDiscount();
    const priceIssues = priceProblems(input, minDiscount, 'draft').map((message) => ({
      path: 'salePrice',
      message,
    }));
    if (priceIssues.length) fail(priceIssues);
    if (input.publish) this.assertPublishable(store, input, minDiscount);

    const productId = await this.db.transaction(async (tx) => {
      const brandId = await this.upsertBrand(tx, input.brand);
      const shortId = newShortId();
      const [product] = await tx
        .insert(products)
        .values({
          shortId,
          storeId,
          brandId,
          categoryId: input.categoryId,
          slug: slugify(`${input.brand} ${input.title}`),
          title: input.title,
          description: input.description ?? null,
          composition: input.composition ?? null,
          gender: input.gender,
        })
        .returning({ id: products.id });
      const id = product!.id;
      await this.setArticle(tx, id, input.article);

      for (const variant of input.variants) {
        await this.insertVariant(tx, {
          productId: id,
          storeId,
          shortId,
          input,
          variant,
          sizes,
          locationId: store.locationId,
          actor,
        });
      }
      await this.replaceImages(tx, id, input.mediaIds);
      if (input.publish) await this.applyPublish(tx, id, 'DRAFT', store.verifiedAt, actor);
      return id;
    });

    await this.audit.record(
      {
        action: input.publish ? 'product.published' : 'product.created',
        actorType: 'USER',
        actorId: actor.userId,
        entityType: 'product',
        entityId: productId,
      },
      actor.request,
    );
    return productId;
  }

  async update(
    storeId: string,
    productId: string,
    input: Partial<ProductInput>,
    actor: Actor,
  ): Promise<void> {
    const store = await this.storeForWrite(storeId);
    const minDiscount = await this.minDiscount();
    const flagged = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(products)
        .where(and(eq(products.id, productId), eq(products.storeId, storeId)))
        .for('update');
      if (!current) throw new NotFoundException('Товар не найден');
      if (!sellerCanEdit(current.status)) throw new ConflictException('Этот товар нельзя изменить');
      const isPublic = isPublicStatus(current.status);
      const existing = await tx
        .select({
          id: productVariants.id,
          sizeValueId: productVariants.sizeValueId,
          isActive: productVariants.isActive,
          originalPrice: productVariants.originalPrice,
          salePrice: productVariants.salePrice,
          referencePrice: productVariants.referencePrice,
          externalPrice: productVariants.externalPrice,
        })
        .from(productVariants)
        .where(eq(productVariants.productId, productId));
      const currentPrices = existing.find((variant) => variant.isActive) ?? existing[0]!;

      const categoryId = input.categoryId ?? current.categoryId;
      const gender = input.gender ?? current.gender;
      const variants =
        input.variants ??
        (input.categoryId !== undefined || input.gender !== undefined
          ? existing
              .filter((v) => v.isActive)
              .map((v) => ({ sizeValueId: v.sizeValueId, quantity: -1 }))
          : undefined);
      const sizes = await this.validateCatalogFields({
        categoryId,
        gender,
        colorId: input.colorId ?? (await this.currentColor(tx, productId)),
        variants:
          variants ??
          existing
            .filter((v) => v.isActive)
            .map((v) => ({ sizeValueId: v.sizeValueId, quantity: 0 })),
      });
      if (input.mediaIds) {
        await this.validateMedia(tx, storeId, input.mediaIds);
        if (isPublic && input.mediaIds.length === 0)
          fail([{ path: 'mediaIds', message: 'images.required' }]);
      }

      const prices = {
        originalPrice: input.originalPrice ?? currentPrices.originalPrice,
        salePrice: input.salePrice ?? currentPrices.salePrice,
      };
      const pricesChanged =
        prices.originalPrice !== currentPrices.originalPrice ||
        prices.salePrice !== currentPrices.salePrice;
      if (pricesChanged) {
        // For a public product validate against the reference the change will produce.
        const referencePrice = isPublic
          ? await referencePriceAfterChange(tx, currentPrices.id, prices.salePrice)
          : (currentPrices.referencePrice ?? null);
        const issues = priceProblems(
          { ...prices, referencePrice, externalPrice: currentPrices.externalPrice },
          minDiscount,
          isPublic ? 'publish' : 'draft',
        );
        if (issues.length) fail(issues.map((message) => ({ path: 'salePrice', message })));
      }

      const brandId =
        input.brand !== undefined ? await this.upsertBrand(tx, input.brand) : current.brandId;
      const [brandRow] = brandId
        ? await tx.select({ name: brands.name }).from(brands).where(eq(brands.id, brandId))
        : [];
      await tx
        .update(products)
        .set({
          brandId,
          categoryId,
          gender,
          ...(input.title !== undefined || input.brand !== undefined
            ? {
                title: input.title ?? current.title,
                slug: slugify(`${brandRow?.name ?? ''} ${input.title ?? current.title}`),
              }
            : {}),
          ...(input.description !== undefined ? { description: input.description || null } : {}),
          ...(input.composition !== undefined ? { composition: input.composition || null } : {}),
        })
        .where(eq(products.id, productId));
      if (input.article !== undefined) await this.setArticle(tx, productId, input.article);
      if (input.colorId !== undefined) {
        await tx
          .update(productVariants)
          .set({ colorId: input.colorId })
          .where(eq(productVariants.productId, productId));
      }

      if (pricesChanged) {
        for (const variant of existing) {
          await setVariantPrices(tx, variant.id, prices, {
            source: 'SELLER',
            actorUserId: actor.userId,
            isPublic: isPublic && variant.isActive,
          });
        }
      }

      if (variants && input.variants) {
        await this.syncVariants(tx, {
          productId,
          storeId,
          shortId: current.shortId,
          article: input.article ?? (await this.currentArticle(tx, productId)),
          colorId: input.colorId ?? (await this.currentColor(tx, productId)),
          prices: { ...prices, externalPrice: currentPrices.externalPrice },
          wanted: input.variants,
          existing,
          sizes,
          locationId: store.locationId,
          actor,
        });
      }
      if (input.mediaIds) await this.replaceImages(tx, productId, input.mediaIds);

      // A raised "price before discount" on a public product goes to an admin.
      if (isPublic && pricesChanged) {
        const reasons = flagReasons({
          previousOriginalPrice: currentPrices.originalPrice,
          prices,
          storeVerifiedAt: store.verifiedAt,
        });
        if (reasons.length) {
          await tx
            .update(products)
            .set({ status: 'FLAGGED', flagReason: reasons.join(',') })
            .where(eq(products.id, productId));
          return true;
        }
      }
      return false;
    });

    await this.audit.record(
      {
        action: flagged ? 'product.flagged' : 'product.updated',
        actorType: 'USER',
        actorId: actor.userId,
        entityType: 'product',
        entityId: productId,
        metadata: { fields: Object.keys(input) },
      },
      actor.request,
    );
    // New stock goes to marketplaces that take our counts (WB write-back).
    if (input.variants) await this.syncScheduler.storeStockChanged(storeId);
  }

  async sellerAction(
    storeId: string,
    productId: string,
    action: 'publish' | 'hide' | 'archive',
    actor: Actor,
  ): Promise<void> {
    const store = action === 'publish' ? await this.storeForWrite(storeId) : null;
    const minDiscount = await this.minDiscount();
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(products)
        .where(and(eq(products.id, productId), eq(products.storeId, storeId)))
        .for('update');
      if (!current) throw new NotFoundException('Товар не найден');
      if (!productActionAllowedFrom(action).includes(current.status))
        throw new ConflictException('Это действие недоступно для товара в текущем статусе');

      if (action === 'publish') {
        const variants = await tx
          .select({
            id: productVariants.id,
            originalPrice: productVariants.originalPrice,
            salePrice: productVariants.salePrice,
            externalPrice: productVariants.externalPrice,
            available: inventory.available,
          })
          .from(productVariants)
          .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
          .where(and(eq(productVariants.productId, productId), eq(productVariants.isActive, true)));
        const [images] = await tx
          .select({ total: count() })
          .from(productImages)
          .where(eq(productImages.productId, productId));
        // A price cut made while hidden is still measured from the prices buyers saw before.
        const referencePrice = variants[0]
          ? await referencePriceAfterChange(tx, variants[0].id, variants[0].salePrice)
          : null;
        this.assertPublishable(
          store!,
          {
            mediaIds: Array.from({ length: images?.total ?? 0 }, () => ''),
            originalPrice: variants[0]?.originalPrice ?? 0,
            salePrice: variants[0]?.salePrice ?? 0,
            referencePrice,
            externalPrice: variants[0]?.externalPrice ?? null,
            variants: variants.map((v) => ({ sizeValueId: null, quantity: v.available ?? 0 })),
          },
          minDiscount,
        );
        await this.applyPublish(tx, productId, current.status, store!.verifiedAt, actor);
      } else {
        await tx
          .update(products)
          .set({ status: nextProductStatus(action, current.status) })
          .where(eq(products.id, productId));
      }
    });
    await this.audit.record(
      {
        action: `product.${action === 'publish' ? 'published' : action === 'hide' ? 'hidden' : 'archived'}`,
        actorType: 'USER',
        actorId: actor.userId,
        entityType: 'product',
        entityId: productId,
      },
      actor.request,
    );
  }

  async sellerProduct(storeId: string, productId: string): Promise<SellerProduct> {
    const [product] = await this.db
      .select({
        id: products.id,
        shortId: products.shortId,
        slug: products.slug,
        status: products.status,
        flagReason: products.flagReason,
        removedReason: products.removedReason,
        title: products.title,
        brand: brands.name,
        categoryId: products.categoryId,
        gender: products.gender,
        description: products.description,
        composition: products.composition,
        publishedAt: products.publishedAt,
        updatedAt: products.updatedAt,
      })
      .from(products)
      .leftJoin(brands, eq(brands.id, products.brandId))
      .where(and(eq(products.id, productId), eq(products.storeId, storeId)));
    if (!product) throw new NotFoundException('Товар не найден');

    const variants = await this.db
      .select({
        id: productVariants.id,
        sizeValueId: productVariants.sizeValueId,
        sizeLabel: sizeValues.code,
        sizePosition: sizeValues.position,
        sku: productVariants.sku,
        article: productVariants.article,
        colorId: productVariants.colorId,
        originalPrice: productVariants.originalPrice,
        salePrice: productVariants.salePrice,
        referencePrice: productVariants.referencePrice,
        discountPercent: productVariants.discountPercent,
        quantity: inventory.quantity,
        reserved: inventory.reserved,
        available: inventory.available,
      })
      .from(productVariants)
      .leftJoin(sizeValues, eq(sizeValues.id, productVariants.sizeValueId))
      .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
      .where(and(eq(productVariants.productId, productId), eq(productVariants.isActive, true)))
      .orderBy(asc(sizeValues.position));
    const images = await this.imagesFor([productId]);
    const first = variants[0];

    return {
      ...product,
      colorId: first?.colorId ?? null,
      article: first?.article ?? null,
      images: images.get(productId) ?? [],
      originalPrice: first?.originalPrice ?? 0,
      salePrice: first?.salePrice ?? 0,
      referencePrice: first?.referencePrice ?? null,
      discountPercent: first?.discountPercent ?? 0,
      variants: variants.map((variant) => ({
        id: variant.id,
        sizeValueId: variant.sizeValueId,
        sizeLabel: variant.sizeLabel,
        sku: variant.sku,
        quantity: variant.quantity ?? 0,
        reserved: variant.reserved ?? 0,
        available: variant.available ?? 0,
      })),
      publishedAt: product.publishedAt?.toISOString() ?? null,
      updatedAt: product.updatedAt.toISOString(),
    };
  }

  async sellerList(
    storeId: string,
    status: ProductStatus | undefined,
    limit: number,
    offset: number,
  ): Promise<ProductList> {
    const where = and(
      eq(products.storeId, storeId),
      status ? eq(products.status, status) : sql`${products.status} <> 'ARCHIVED'`,
    );
    return this.list(where, desc(products.updatedAt), limit, offset);
  }

  // ───────────────────────── admin ─────────────────────────

  async adminFeed(
    filter: 'flagged' | 'recent' | 'removed',
    limit: number,
    offset: number,
  ): Promise<ProductList> {
    if (filter === 'flagged')
      return this.list(eq(products.status, 'FLAGGED'), desc(products.updatedAt), limit, offset);
    if (filter === 'removed')
      return this.list(eq(products.status, 'REMOVED'), desc(products.removedAt), limit, offset);
    return this.list(
      inArray(products.status, ['ACTIVE', 'FLAGGED']),
      desc(products.publishedAt),
      limit,
      offset,
    );
  }

  async adminAction(
    productId: string,
    action: Extract<ProductAction, 'remove' | 'restore' | 'clearFlag'>,
    actor: Actor,
    reason?: string,
  ): Promise<void> {
    const allowed = productActionAllowedFrom(action);
    const [current] = await this.db
      .select({ status: products.status })
      .from(products)
      .where(eq(products.id, productId));
    if (!current) throw new NotFoundException('Товар не найден');
    if (!allowed.includes(current.status))
      throw new ConflictException('Это действие недоступно для товара в текущем статусе');
    const [updated] = await this.db
      .update(products)
      .set({
        status: nextProductStatus(action, current.status),
        ...(action === 'remove'
          ? { removedReason: reason!, removedBy: actor.userId, removedAt: sql`now()` }
          : {}),
        ...(action === 'restore' ? { removedReason: null, removedBy: null, removedAt: null } : {}),
        ...(action === 'clearFlag' ? { flagReason: null } : {}),
      })
      .where(and(eq(products.id, productId), inArray(products.status, [...allowed])))
      .returning({ id: products.id });
    if (!updated)
      throw new ConflictException('Статус товара только что изменился. Обновите страницу.');
    await this.audit.record(
      {
        action: {
          remove: 'product.removed',
          restore: 'product.restored',
          clearFlag: 'product.flag_cleared',
        }[action],
        actorType: 'USER',
        actorId: actor.userId,
        entityType: 'product',
        entityId: productId,
        metadata: reason ? { reason } : undefined,
      },
      actor.request,
    );
  }

  // ───────────────────────── internals ─────────────────────────

  private async storeForWrite(storeId: string) {
    const [store] = await this.db
      .select({
        status: stores.status,
        verifiedAt: stores.verifiedAt,
        locationId: storeLocations.id,
      })
      .from(stores)
      .innerJoin(storeLocations, eq(storeLocations.storeId, stores.id))
      .where(eq(stores.id, storeId));
    if (!store) throw new NotFoundException('Магазин не найден');
    return store;
  }

  private assertPublishable(
    store: { status: string },
    input: Pick<ProductInput, 'mediaIds' | 'originalPrice' | 'salePrice'> & {
      variants: { quantity: number }[];
      referencePrice?: number | null;
      externalPrice?: number | null;
    },
    minDiscount: number,
  ): void {
    const issues: Issue[] = [];
    if (store.status !== 'VERIFIED') issues.push({ path: 'publish', message: 'store.notVerified' });
    if (input.mediaIds.length === 0) issues.push({ path: 'mediaIds', message: 'images.required' });
    if (!input.variants.some((variant) => variant.quantity > 0))
      issues.push({ path: 'variants', message: 'stock.required' });
    for (const message of priceProblems(input, minDiscount, 'publish'))
      issues.push({ path: 'salePrice', message });
    if (issues.length) fail(issues);
  }

  private async applyPublish(
    tx: Transaction,
    productId: string,
    from: ProductStatus,
    storeVerifiedAt: Date | null,
    actor: Actor,
  ): Promise<void> {
    const variants = await tx
      .select({
        id: productVariants.id,
        originalPrice: productVariants.originalPrice,
        salePrice: productVariants.salePrice,
      })
      .from(productVariants)
      .where(and(eq(productVariants.productId, productId), eq(productVariants.isActive, true)));
    const [lastPublic] = await tx
      .select({ originalPrice: priceHistory.originalPrice })
      .from(priceHistory)
      .where(
        and(
          inArray(
            priceHistory.variantId,
            variants.map((v) => v.id),
          ),
          eq(priceHistory.isPublic, true),
        ),
      )
      .orderBy(desc(priceHistory.createdAt))
      .limit(1);
    const reasons = flagReasons({
      previousOriginalPrice: lastPublic?.originalPrice ?? null,
      prices: variants[0]!,
      storeVerifiedAt,
    });
    await tx
      .update(products)
      .set({
        status: nextProductStatus('publish', from, reasons.length > 0),
        flagReason: reasons.length ? reasons.join(',') : null,
        publishedAt: sql`now()`,
      })
      .where(eq(products.id, productId));
    await recordPublishedPrices(
      tx,
      variants.map((v) => v.id),
      actor.userId,
    );
  }

  /** Category must be an active leaf; sizes must come from its size chart (kids' clothing: by height). */
  private async validateCatalogFields(input: {
    categoryId: number;
    gender: Gender;
    colorId: number;
    variants: { sizeValueId: number | null }[];
  }) {
    const [category] = await this.db
      .select({
        id: categories.id,
        parentId: categories.parentId,
        isActive: categories.isActive,
        sizeChartId: categories.sizeChartId,
      })
      .from(categories)
      .where(eq(categories.id, input.categoryId));
    const [child] = await this.db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.parentId, input.categoryId))
      .limit(1);
    if (!category || !category.isActive || child)
      fail([{ path: 'categoryId', message: 'category.invalid' }]);
    const [root] = category!.parentId
      ? await this.db
          .select({ slug: categories.slug })
          .from(categories)
          .where(eq(categories.id, category!.parentId))
      : [{ slug: '' }];
    const [color] = await this.db
      .execute<{ id: number }>(sql`select id from colors where id = ${input.colorId}`)
      .then((r) => r.rows);
    if (!color) fail([{ path: 'colorId', message: 'color.invalid' }]);

    let chartId = category!.sizeChartId;
    if (root?.slug === 'clothing' && input.gender === 'KIDS') {
      const [kids] = await this.db
        .select({ id: sizeCharts.id })
        .from(sizeCharts)
        .where(eq(sizeCharts.code, KIDS_HEIGHT_CHART));
      chartId = kids?.id ?? chartId;
    }
    if (chartId === null) {
      if (input.variants.length !== 1 || input.variants[0]!.sizeValueId !== null)
        fail([{ path: 'variants', message: 'sizes.oneSizeOnly' }]);
      return new Map<number, string>();
    }
    if (input.variants.some((variant) => variant.sizeValueId === null))
      fail([{ path: 'variants', message: 'sizes.required' }]);
    const ids = input.variants.map((variant) => variant.sizeValueId!);
    const rows = await this.db
      .select({ id: sizeValues.id, code: sizeValues.code })
      .from(sizeValues)
      .where(and(eq(sizeValues.chartId, chartId), inArray(sizeValues.id, ids)));
    if (rows.length !== new Set(ids).size)
      fail([{ path: 'variants', message: 'sizes.wrongChart' }]);
    return new Map(rows.map((row) => [row.id, row.code]));
  }

  /** Photos must belong to this store: no attaching another store's images. */
  private async validateMedia(
    executor: Database | Transaction,
    storeId: string,
    mediaIds: string[],
  ): Promise<void> {
    if (mediaIds.length === 0) return;
    if (new Set(mediaIds).size !== mediaIds.length)
      fail([{ path: 'mediaIds', message: 'images.duplicate' }]);
    const rows = await executor
      .select({ id: storeMedia.id })
      .from(storeMedia)
      .where(and(eq(storeMedia.storeId, storeId), inArray(storeMedia.id, mediaIds)));
    if (rows.length !== mediaIds.length) fail([{ path: 'mediaIds', message: 'images.notFound' }]);
  }

  private async upsertBrand(tx: Transaction, name: string): Promise<string> {
    const clean = name.trim().replace(/\s+/g, ' ');
    await tx
      .insert(brands)
      .values({ name: clean, slug: slugify(clean) })
      .onConflictDoNothing();
    const [brand] = await tx
      .select({ id: brands.id })
      .from(brands)
      .where(sql`lower(${brands.name}) = lower(${clean})`);
    if (brand) return brand.id;
    // Same slug, different spelling (e.g. "H&M" vs "H and M"): reuse the existing brand.
    const [bySlug] = await tx
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.slug, slugify(clean)));
    return bySlug!.id;
  }

  private async insertVariant(
    tx: Transaction,
    args: {
      productId: string;
      storeId: string;
      shortId: string;
      input: Pick<
        ProductInput,
        'article' | 'colorId' | 'originalPrice' | 'salePrice' | 'externalPrice'
      >;
      variant: VariantInput;
      sizes: Map<number, string>;
      locationId: string;
      actor: Actor;
    },
  ): Promise<void> {
    const sizeCode = args.variant.sizeValueId ? args.sizes.get(args.variant.sizeValueId)! : 'ONE';
    const sku =
      args.variant.sku ?? `${(args.input.article || args.shortId).toUpperCase()}-${sizeCode}`;
    const [variant] = await tx
      .insert(productVariants)
      .values({
        productId: args.productId,
        storeId: args.storeId,
        sku,
        article: args.input.article ?? null,
        sizeValueId: args.variant.sizeValueId,
        colorId: args.input.colorId,
        originalPrice: args.input.originalPrice,
        salePrice: args.input.salePrice,
        externalPrice: args.input.externalPrice ?? null,
      })
      .onConflictDoNothing({ target: [productVariants.storeId, productVariants.sku] })
      .returning({ id: productVariants.id });
    if (!variant) fail([{ path: 'variants', message: 'sku.duplicate' }]);
    await setStockLevel(
      tx,
      { variantId: variant!.id, locationId: args.locationId, quantity: args.variant.quantity },
      { refType: 'product', refId: args.productId, actorUserId: args.actor.userId },
    );
  }

  private async syncVariants(
    tx: Transaction,
    args: {
      productId: string;
      storeId: string;
      shortId: string;
      article: string | undefined;
      colorId: number;
      prices: { originalPrice: number; salePrice: number; externalPrice: number | null };
      wanted: VariantInput[];
      existing: { id: string; sizeValueId: number | null; isActive: boolean }[];
      sizes: Map<number, string>;
      locationId: string;
      actor: Actor;
    },
  ): Promise<void> {
    const ref = { refType: 'product', refId: args.productId, actorUserId: args.actor.userId };
    try {
      for (const wanted of args.wanted) {
        const match = args.existing.find((variant) => variant.sizeValueId === wanted.sizeValueId);
        if (match) {
          if (!match.isActive)
            await tx
              .update(productVariants)
              .set({ isActive: true })
              .where(eq(productVariants.id, match.id));
          await setStockLevel(
            tx,
            { variantId: match.id, locationId: args.locationId, quantity: wanted.quantity },
            ref,
          );
        } else {
          await this.insertVariant(tx, {
            productId: args.productId,
            storeId: args.storeId,
            shortId: args.shortId,
            input: { article: args.article, colorId: args.colorId, ...args.prices },
            variant: wanted,
            sizes: args.sizes,
            locationId: args.locationId,
            actor: args.actor,
          });
        }
      }
      // Sizes removed from the form are switched off; units promised to buyers block the removal.
      for (const variant of args.existing.filter(
        (v) => v.isActive && !args.wanted.some((w) => w.sizeValueId === v.sizeValueId),
      )) {
        await setStockLevel(
          tx,
          { variantId: variant.id, locationId: args.locationId, quantity: 0 },
          ref,
        );
        await tx
          .update(productVariants)
          .set({ isActive: false })
          .where(eq(productVariants.id, variant.id));
      }
    } catch (error) {
      if (error instanceof InventoryConflictError)
        fail([{ path: 'variants', message: 'stock.belowReserved' }]);
      throw error;
    }
  }

  private async replaceImages(
    tx: Transaction,
    productId: string,
    mediaIds: string[],
  ): Promise<void> {
    await tx.delete(productImages).where(eq(productImages.productId, productId));
    if (mediaIds.length === 0) return;
    await tx
      .insert(productImages)
      .values(mediaIds.map((mediaId, position) => ({ productId, mediaId, position })));
  }

  private async setArticle(
    tx: Transaction,
    productId: string,
    article: string | undefined,
  ): Promise<void> {
    if (article === undefined) return;
    await tx
      .update(productVariants)
      .set({ article: article || null })
      .where(eq(productVariants.productId, productId));
  }

  private async currentArticle(tx: Transaction, productId: string): Promise<string | undefined> {
    const [row] = await tx
      .select({ article: productVariants.article })
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
      .limit(1);
    return row?.article ?? undefined;
  }

  private async currentColor(executor: Database | Transaction, productId: string): Promise<number> {
    const [row] = await executor
      .select({ colorId: productVariants.colorId })
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
      .limit(1);
    return row?.colorId ?? 0;
  }

  private async minDiscount(): Promise<number> {
    const [row] = await this.db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'catalog.min_discount_percent'));
    return Number(row?.value ?? 30);
  }

  private async imagesFor(productIds: string[]) {
    const result = new Map<string, ReturnType<typeof toMedia>[]>();
    if (productIds.length === 0) return result;
    const rows = await this.db
      .select({
        productId: productImages.productId,
        id: storeMedia.id,
        baseKey: storeMedia.baseKey,
        width: storeMedia.width,
        height: storeMedia.height,
      })
      .from(productImages)
      .innerJoin(storeMedia, eq(storeMedia.id, productImages.mediaId))
      .where(inArray(productImages.productId, productIds))
      .orderBy(asc(productImages.position));
    for (const row of rows) {
      const list = result.get(row.productId) ?? [];
      list.push(toMedia(row));
      result.set(row.productId, list);
    }
    return result;
  }

  private async list(
    where: ReturnType<typeof and>,
    order: ReturnType<typeof desc>,
    limit: number,
    offset: number,
  ): Promise<ProductList> {
    const [rows, [{ total } = { total: 0 }]] = await Promise.all([
      this.db
        .select({
          id: products.id,
          shortId: products.shortId,
          title: products.title,
          brand: brands.name,
          status: products.status,
          flagReason: products.flagReason,
          removedReason: products.removedReason,
          storeId: stores.id,
          storeName: stores.name,
          updatedAt: products.updatedAt,
          createdAt: products.createdAt,
        })
        .from(products)
        .innerJoin(stores, eq(stores.id, products.storeId))
        .leftJoin(brands, eq(brands.id, products.brandId))
        .where(where)
        .orderBy(order, desc(products.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(products).where(where),
    ]);
    const ids = rows.map((row) => row.id);
    const [variantRows, images] = await Promise.all([
      ids.length
        ? this.db
            .select({
              productId: productVariants.productId,
              label: sizeValues.code,
              position: sizeValues.position,
              originalPrice: productVariants.originalPrice,
              salePrice: productVariants.salePrice,
              discountPercent: productVariants.discountPercent,
              available: inventory.available,
            })
            .from(productVariants)
            .leftJoin(sizeValues, eq(sizeValues.id, productVariants.sizeValueId))
            .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
            .where(and(inArray(productVariants.productId, ids), eq(productVariants.isActive, true)))
            .orderBy(asc(sizeValues.position))
        : Promise.resolve([]),
      this.imagesFor(ids),
    ]);
    const items: ProductListItem[] = rows.map((row) => {
      const variants = variantRows.filter((variant) => variant.productId === row.id);
      const first = variants[0];
      return {
        ...row,
        image: images.get(row.id)?.[0] ?? null,
        originalPrice: first?.originalPrice ?? 0,
        salePrice: first?.salePrice ?? 0,
        discountPercent: first?.discountPercent ?? 0,
        available: variants.reduce((sum, variant) => sum + (variant.available ?? 0), 0),
        sizes: variants.map((variant) => ({
          label: variant.label,
          available: variant.available ?? 0,
        })),
        updatedAt: row.updatedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      };
    });
    return { items, total };
  }
}
