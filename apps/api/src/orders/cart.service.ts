import { Inject, Injectable } from '@nestjs/common';
import { type Cart, type CartItem, MAX_CART_QUANTITY, productPath } from '@lastsize/contracts';
import { type Database, sql } from '@lastsize/db';
import { DATABASE } from '../infrastructure/infrastructure.module';
import { toMedia } from '../media/media.service';
import { ValidationFailedException } from '../security/zod-validation.pipe';

/** Different sizes in one cart; plenty for a sale, small enough to stop abuse. */
const MAX_CART_LINES = 50;

interface CartRow extends Record<string, unknown> {
  variant_id: string;
  quantity: number;
  price_snapshot: string;
  sale_price: string;
  original_price: string;
  discount_percent: number;
  available: number | null;
  size: string | null;
  product_id: string;
  short_id: string;
  slug: string;
  title: string;
  brand: string | null;
  sellable: boolean;
  store_id: string;
  store_name: string;
  store_slug: string;
  address: string;
  location_id: string;
  pickup_enabled: boolean;
  delivery_enabled: boolean;
  image_id: string | null;
  image_key: string | null;
  image_width: number | null;
  image_height: number | null;
}

export interface CartLine {
  variantId: string;
  quantity: number;
  unitPrice: number;
  storeId: string;
  locationId: string;
}

/**
 * The guest's cart lives on the server, so checkout always uses current prices and stock and
 * never trusts amounts sent by the browser.
 */
@Injectable()
export class CartService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async view(customerId: string | null): Promise<{ cart: Cart; lines: CartLine[] }> {
    if (!customerId) {
      return { cart: { stores: [], itemCount: 0, itemsTotal: 0, hasProblems: false }, lines: [] };
    }
    const { rows } = await this.db.execute<CartRow>(sql`
      SELECT ci.variant_id, ci.quantity, ci.price_snapshot,
             v.sale_price, v.original_price, v.discount_percent,
             i.available, sv.code AS size,
             p.id AS product_id, p.short_id, p.slug, p.title, b.name AS brand,
             (p.status IN ('ACTIVE', 'FLAGGED') AND s.status = 'VERIFIED' AND v.is_active) AS sellable,
             s.id AS store_id, s.name AS store_name, s.slug AS store_slug,
             l.address, l.id AS location_id, l.pickup_enabled, l.delivery_enabled,
             m.id AS image_id, m.base_key AS image_key, m.width AS image_width, m.height AS image_height
      FROM cart_items ci
      JOIN product_variants v ON v.id = ci.variant_id
      JOIN products p ON p.id = v.product_id
      JOIN stores s ON s.id = p.store_id
      JOIN store_locations l ON l.store_id = s.id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN size_values sv ON sv.id = v.size_value_id
      LEFT JOIN inventory i ON i.variant_id = v.id AND i.location_id = l.id
      LEFT JOIN LATERAL (
        SELECT sm.id, sm.base_key, sm.width, sm.height FROM product_images pi
        JOIN store_media sm ON sm.id = pi.media_id
        WHERE pi.product_id = p.id ORDER BY pi.position LIMIT 1
      ) m ON true
      WHERE ci.customer_id = ${customerId}
      ORDER BY s.name, ci.created_at`);

    const stores = new Map<string, Cart['stores'][number]>();
    const lines: CartLine[] = [];
    let hasProblems = false;
    for (const row of rows) {
      const available = row.sellable ? Math.max(row.available ?? 0, 0) : 0;
      const unitPrice = Number(row.sale_price);
      const problem: CartItem['problem'] =
        !row.sellable || available === 0
          ? 'unavailable'
          : row.quantity > available
            ? 'notEnough'
            : null;
      if (problem) hasProblems = true;
      const item: CartItem = {
        variantId: row.variant_id,
        productPath: productPath({ slug: row.slug, shortId: row.short_id }),
        title: row.title,
        brand: row.brand,
        size: row.size,
        image:
          row.image_id && row.image_key
            ? toMedia({
                id: row.image_id,
                baseKey: row.image_key,
                width: row.image_width ?? 0,
                height: row.image_height ?? 0,
              })
            : null,
        quantity: row.quantity,
        available,
        unitPrice,
        originalPrice: Number(row.original_price),
        discountPercent: row.discount_percent,
        priceChanged: Number(row.price_snapshot) !== unitPrice,
        previousPrice: Number(row.price_snapshot),
        problem,
      };
      const store = stores.get(row.store_id) ?? {
        storeId: row.store_id,
        name: row.store_name,
        slug: row.store_slug,
        address: row.address,
        pickupEnabled: row.pickup_enabled,
        deliveryEnabled: row.delivery_enabled,
        items: [],
        itemsTotal: 0,
      };
      store.items.push(item);
      if (!problem) store.itemsTotal += unitPrice * row.quantity;
      stores.set(row.store_id, store);
      lines.push({
        variantId: row.variant_id,
        quantity: row.quantity,
        unitPrice,
        storeId: row.store_id,
        locationId: row.location_id,
      });
    }
    const list = [...stores.values()];
    return {
      cart: {
        stores: list,
        itemCount: rows.reduce((sum, row) => sum + row.quantity, 0),
        itemsTotal: list.reduce((sum, store) => sum + store.itemsTotal, 0),
        hasProblems,
      },
      lines,
    };
  }

  async count(customerId: string | null): Promise<number> {
    if (!customerId) return 0;
    const { rows } = await this.db.execute<{ count: number }>(
      sql`SELECT coalesce(sum(quantity), 0)::int AS count FROM cart_items WHERE customer_id = ${customerId}`,
    );
    return rows[0]?.count ?? 0;
  }

  /** One more of this size, within what is free in the store. */
  async add(customerId: string, variantId: string): Promise<void> {
    const variant = await this.sellableVariant(variantId);
    const [current] = (
      await this.db.execute<{ quantity: number; lines: number }>(sql`
        SELECT (SELECT quantity FROM cart_items WHERE customer_id = ${customerId} AND variant_id = ${variantId}) AS quantity,
               (SELECT count(*)::int FROM cart_items WHERE customer_id = ${customerId}) AS lines`)
    ).rows;
    const quantity = (current?.quantity ?? 0) + 1;
    if (!current?.quantity && (current?.lines ?? 0) >= MAX_CART_LINES)
      throw new ValidationFailedException([{ path: 'variantId', message: 'cart.full' }]);
    if (quantity > MAX_CART_QUANTITY)
      throw new ValidationFailedException([{ path: 'variantId', message: 'quantity.tooMany' }]);
    if (quantity > variant.available)
      throw new ValidationFailedException([{ path: 'variantId', message: 'stock.notEnough' }]);
    await this.db.execute(sql`
      INSERT INTO cart_items (customer_id, variant_id, quantity, price_snapshot)
      VALUES (${customerId}, ${variantId}, 1, ${variant.price})
      ON CONFLICT (customer_id, variant_id) DO UPDATE SET quantity = cart_items.quantity + 1`);
  }

  async setQuantity(customerId: string, variantId: string, quantity: number): Promise<void> {
    const variant = await this.sellableVariant(variantId);
    if (quantity > variant.available)
      throw new ValidationFailedException([{ path: 'quantity', message: 'stock.notEnough' }]);
    await this.db.execute(sql`
      UPDATE cart_items SET quantity = ${quantity}
      WHERE customer_id = ${customerId} AND variant_id = ${variantId}`);
  }

  async remove(customerId: string, variantId: string): Promise<void> {
    await this.db.execute(
      sql`DELETE FROM cart_items WHERE customer_id = ${customerId} AND variant_id = ${variantId}`,
    );
  }

  /** The buyer saw the new prices: remember them so checkout can go on. */
  async acceptPrices(customerId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE cart_items ci SET price_snapshot = v.sale_price
      FROM product_variants v
      WHERE v.id = ci.variant_id AND ci.customer_id = ${customerId}
        AND ci.price_snapshot <> v.sale_price`);
  }

  private async sellableVariant(variantId: string): Promise<{ price: number; available: number }> {
    const [row] = (
      await this.db.execute<{ price: string; available: number | null }>(sql`
        SELECT v.sale_price AS price, i.available
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        JOIN stores s ON s.id = p.store_id
        JOIN store_locations l ON l.store_id = s.id
        LEFT JOIN inventory i ON i.variant_id = v.id AND i.location_id = l.id
        WHERE v.id = ${variantId} AND v.is_active
          AND p.status IN ('ACTIVE', 'FLAGGED') AND s.status = 'VERIFIED'`)
    ).rows;
    if (!row || (row.available ?? 0) <= 0)
      throw new ValidationFailedException([{ path: 'variantId', message: 'stock.soldOut' }]);
    return { price: Number(row.price), available: row.available ?? 0 };
  }
}
