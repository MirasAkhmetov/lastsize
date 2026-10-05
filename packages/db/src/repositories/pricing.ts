import { eq, sql } from 'drizzle-orm';
import type { Executor } from '../client.js';
import { productVariants } from '../schema/index.js';

export interface PriceChange {
  originalPrice: number;
  salePrice: number;
}

export interface PriceChangeContext {
  source: 'SELLER' | 'IMPORT' | 'ADMIN';
  actorUserId?: string | null;
}

/**
 * Changes the prices of a variant. The database trigger writes price_history; the source and
 * actor are passed through transaction-local settings so they cannot leak to other requests.
 */
export async function setVariantPrices(
  executor: Executor,
  variantId: string,
  prices: PriceChange,
  context: PriceChangeContext,
): Promise<void> {
  await executor.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.price_source', ${context.source}, true),
                                set_config('app.actor_id', ${context.actorUserId ?? ''}, true)`);
    await tx
      .update(productVariants)
      .set({ originalPrice: prices.originalPrice, salePrice: prices.salePrice })
      .where(eq(productVariants.id, variantId));
  });
}
