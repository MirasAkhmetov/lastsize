import { and, desc, eq, gt, inArray, min, sql } from 'drizzle-orm';
import type { Executor, Transaction } from '../client.js';
import { priceHistory, productVariants } from '../schema/index.js';

export interface PriceChange {
  originalPrice: number;
  salePrice: number;
}

export interface PriceChangeContext {
  source: 'SELLER' | 'IMPORT' | 'ADMIN';
  actorUserId?: string | null;
  /** The product is published, so buyers see this price. */
  isPublic?: boolean;
}

/**
 * Lowest price buyers actually saw in the last 30 days, or null. Draft edits do not count,
 * so fixing a typo before publishing never hurts the discount.
 */
export async function lowestPublicPrice(
  executor: Executor | Transaction,
  variantId: string,
): Promise<number | null> {
  const [row] = await executor
    .select({ lowest: min(priceHistory.salePrice) })
    .from(priceHistory)
    .where(
      and(
        eq(priceHistory.variantId, variantId),
        eq(priceHistory.isPublic, true),
        gt(priceHistory.createdAt, sql`now() - interval '30 days'`),
      ),
    );
  return row?.lowest ?? null;
}

async function describeChange(tx: Transaction, context: PriceChangeContext): Promise<void> {
  await tx.execute(sql`select set_config('app.price_source', ${context.source}, true),
                              set_config('app.actor_id', ${context.actorUserId ?? ''}, true),
                              set_config('app.price_public', ${context.isPublic ? 'true' : 'false'}, true)`);
}

/**
 * Reference price a variant gets when its sale price moves to `newSalePrice` while public.
 * Only a reduction is measured against history (the lowest public price of the last 30 days,
 * including the price being cut). Unchanged or higher prices keep the stored reference, so
 * editing the "price before discount" or republishing never wipes out an honest discount.
 */
export async function referencePriceAfterChange(
  executor: Executor | Transaction,
  variantId: string,
  newSalePrice: number,
): Promise<number | null> {
  const [variant] = await executor
    .select({
      salePrice: productVariants.salePrice,
      referencePrice: productVariants.referencePrice,
    })
    .from(productVariants)
    .where(eq(productVariants.id, variantId));
  if (!variant) return null;
  const [lastPublic] = await executor
    .select({ salePrice: priceHistory.salePrice })
    .from(priceHistory)
    .where(and(eq(priceHistory.variantId, variantId), eq(priceHistory.isPublic, true)))
    .orderBy(desc(priceHistory.createdAt))
    .limit(1);
  // Compare with the last price buyers saw: edits made while hidden count as one change.
  const previousPublicSale = lastPublic?.salePrice ?? null;
  if (previousPublicSale === null || newSalePrice >= previousPublicSale)
    return variant.referencePrice;
  return lowestPublicPrice(executor, variantId);
}

/**
 * Changes the prices of a variant. The database trigger writes price_history; source, actor and
 * visibility travel in transaction-local settings so they cannot leak to other requests.
 */
export async function setVariantPrices(
  executor: Executor,
  variantId: string,
  prices: PriceChange,
  context: PriceChangeContext,
): Promise<void> {
  await executor.transaction(async (tx) => {
    await describeChange(tx, context);
    const referencePrice = context.isPublic
      ? await referencePriceAfterChange(tx, variantId, prices.salePrice)
      : undefined;
    await tx
      .update(productVariants)
      .set({
        originalPrice: prices.originalPrice,
        salePrice: prices.salePrice,
        ...(referencePrice !== undefined ? { referencePrice } : {}),
      })
      .where(eq(productVariants.id, variantId));
  });
}

/**
 * Called when a product goes on sale: sets the reference price (see referencePriceAfterChange)
 * and records the current prices as public.
 */
export async function recordPublishedPrices(
  executor: Executor,
  variantIds: readonly string[],
  actorUserId: string | null,
): Promise<void> {
  if (variantIds.length === 0) return;
  await executor.transaction(async (tx) => {
    const variants = await tx
      .select({
        id: productVariants.id,
        originalPrice: productVariants.originalPrice,
        salePrice: productVariants.salePrice,
      })
      .from(productVariants)
      .where(inArray(productVariants.id, [...variantIds]));
    for (const variant of variants) {
      const referencePrice = await referencePriceAfterChange(tx, variant.id, variant.salePrice);
      await tx
        .update(productVariants)
        .set({ referencePrice })
        .where(eq(productVariants.id, variant.id));
      await tx.insert(priceHistory).values({
        variantId: variant.id,
        originalPrice: variant.originalPrice,
        salePrice: variant.salePrice,
        source: 'SELLER',
        changedBy: actorUserId,
        isPublic: true,
      });
    }
  });
}
