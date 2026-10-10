import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CATALOG_PAGE_SIZE,
  type CatalogCard,
  type CatalogQuery,
  type CatalogResponse,
  type ProductDetail,
  type PublicStore,
  type SitemapData,
} from '@lastsize/contracts';
import { type Database, sql } from '@lastsize/db';
import { DATABASE } from '../infrastructure/infrastructure.module';
import { toMedia } from '../media/media.service';

type SQL = ReturnType<typeof sql>;

/** What buyers may see: published products of verified stores. */
const VISIBLE = sql`p.status IN ('ACTIVE', 'FLAGGED') AND s.status = 'VERIFIED'`;

const GENDERS: Record<string, string[]> = {
  women: ['WOMEN', 'UNISEX'],
  men: ['MEN', 'UNISEX'],
  kids: ['KIDS'],
};

/** Escapes LIKE wildcards so a search for "100%" means the text "100%". */
function likePattern(text: string): string {
  return `%${text.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function list(values: readonly (string | number)[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
}

/** Per-product aggregate over active sizes: price, discount, stock and size list. */
const VARIANTS = sql`
  SELECT pv.product_id,
         min(pv.sale_price)::bigint        AS sale_price,
         min(pv.original_price)::bigint    AS original_price,
         max(pv.discount_percent)::int     AS discount_percent,
         sum(coalesce(i.available, 0))::int AS available,
         jsonb_agg(jsonb_build_object('id', pv.size_value_id, 'label', sv.code, 'available', coalesce(i.available, 0))
                   ORDER BY sv.position NULLS FIRST) AS sizes
  FROM product_variants pv
  LEFT JOIN inventory i ON i.variant_id = pv.id
  LEFT JOIN size_values sv ON sv.id = pv.size_value_id
  WHERE pv.is_active
  GROUP BY pv.product_id`;

interface CardRow extends Record<string, unknown> {
  short_id: string;
  slug: string;
  title: string;
  brand: string | null;
  base_key: string | null;
  width: number | null;
  height: number | null;
  media_id: string | null;
  sale_price: string | number;
  original_price: string | number;
  discount_percent: number;
  available: number;
  sizes: { id: number | null; label: string | null; available: number }[];
  store_slug: string;
  store_name: string;
  city_ru: string;
  city_kk: string;
  total: string | number;
}

@Injectable()
export class CatalogService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async search(query: CatalogQuery): Promise<CatalogResponse> {
    const scope = await this.scope(query);
    const filters: SQL[] = [...scope, sql`v.available > 0`];
    if (query.store?.length) filters.push(sql`s.slug IN (${list(query.store)})`);
    if (query.brand?.length) filters.push(sql`b.slug IN (${list(query.brand)})`);
    if (query.color?.length) {
      filters.push(sql`EXISTS (SELECT 1 FROM product_variants cv JOIN colors co ON co.id = cv.color_id
                               WHERE cv.product_id = p.id AND co.code IN (${list(query.color)}))`);
    }
    if (query.size?.length) {
      const ids = query.size.map(Number);
      filters.push(sql`EXISTS (SELECT 1 FROM product_variants sv2 JOIN inventory i2 ON i2.variant_id = sv2.id
                               WHERE sv2.product_id = p.id AND sv2.is_active AND i2.available > 0
                                 AND sv2.size_value_id IN (${list(ids)}))`);
    }
    if (query.priceMin !== undefined) filters.push(sql`v.sale_price >= ${query.priceMin * 100}`);
    if (query.priceMax !== undefined) filters.push(sql`v.sale_price <= ${query.priceMax * 100}`);
    if (query.discount !== undefined) filters.push(sql`v.discount_percent >= ${query.discount}`);
    if (query.pickup) filters.push(sql`sl.pickup_enabled`);

    const order = {
      newest: sql`p.published_at DESC, p.id DESC`,
      discount: sql`v.discount_percent DESC, p.published_at DESC, p.id DESC`,
      price_asc: sql`v.sale_price ASC, p.id DESC`,
      price_desc: sql`v.sale_price DESC, p.id DESC`,
      // Few units left first: "last sizes" are what an outlet buyer hunts for.
      last_sizes: sql`v.available ASC, v.discount_percent DESC, p.id DESC`,
    }[query.sort];

    const offset = (query.page - 1) * CATALOG_PAGE_SIZE;
    const [rows, facets] = await Promise.all([
      this.db
        .execute<CardRow>(
          sql`
          SELECT p.short_id, p.slug, p.title, b.name AS brand,
                 img.base_key, img.width, img.height, img.id AS media_id,
                 v.sale_price, v.original_price, v.discount_percent, v.available, v.sizes,
                 s.slug AS store_slug, s.name AS store_name, c.name_ru AS city_ru, c.name_kk AS city_kk,
                 count(*) OVER () AS total
          FROM products p
          JOIN (${VARIANTS}) v ON v.product_id = p.id
          JOIN stores s ON s.id = p.store_id
          JOIN store_locations sl ON sl.store_id = s.id
          JOIN cities c ON c.id = sl.city_id
          LEFT JOIN brands b ON b.id = p.brand_id
          LEFT JOIN LATERAL (
            SELECT sm.id, sm.base_key, sm.width, sm.height FROM product_images pi
            JOIN store_media sm ON sm.id = pi.media_id
            WHERE pi.product_id = p.id ORDER BY pi.position LIMIT 1
          ) img ON true
          WHERE ${sql.join(filters, sql` AND `)}
          ORDER BY ${order}
          LIMIT ${CATALOG_PAGE_SIZE} OFFSET ${offset}`,
        )
        .then((result) => result.rows),
      this.facets(scope),
    ]);

    const total = Number(rows[0]?.total ?? 0);
    return {
      items: rows.map((row) => this.toCard(row)),
      total,
      page: query.page,
      pages: Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE)),
      facets,
    };
  }

  async product(shortId: string): Promise<ProductDetail> {
    const [row] = await this.db
      .execute<Record<string, unknown>>(
        sql`
        SELECT p.id, p.short_id, p.slug, p.title, p.gender, p.description, p.composition, p.published_at, p.updated_at,
               b.name AS brand_name, b.slug AS brand_slug,
               cat.slug AS cat_slug, cat.name_ru AS cat_ru, cat.name_kk AS cat_kk,
               par.slug AS par_slug, par.name_ru AS par_ru, par.name_kk AS par_kk,
               s.slug AS store_slug, s.name AS store_name, s.instagram,
               c.name_ru AS city_ru, c.name_kk AS city_kk,
               sl.address, sl.phone, sl.schedule, sl.pickup_enabled
        FROM products p
        JOIN stores s ON s.id = p.store_id
        JOIN store_locations sl ON sl.store_id = s.id
        JOIN cities c ON c.id = sl.city_id
        JOIN categories cat ON cat.id = p.category_id
        LEFT JOIN categories par ON par.id = cat.parent_id
        LEFT JOIN brands b ON b.id = p.brand_id
        WHERE p.short_id = ${shortId} AND ${VISIBLE}`,
      )
      .then((result) => result.rows);
    if (!row) throw new NotFoundException('Товар не найден');
    const productId = row.id as string;

    const [variants, images, history] = await Promise.all([
      this.db
        .execute<Record<string, unknown>>(
          sql`
          SELECT pv.id, pv.size_value_id, sv.code, pv.article, pv.sale_price, pv.original_price, pv.reference_price,
                 pv.discount_percent, coalesce(i.available, 0) AS available,
                 co.code AS color_code, co.name_ru AS color_ru, co.name_kk AS color_kk, co.hex
          FROM product_variants pv
          LEFT JOIN size_values sv ON sv.id = pv.size_value_id
          LEFT JOIN inventory i ON i.variant_id = pv.id
          LEFT JOIN colors co ON co.id = pv.color_id
          WHERE pv.product_id = ${productId} AND pv.is_active
          ORDER BY sv.position NULLS FIRST`,
        )
        .then((result) => result.rows),
      this.db
        .execute<{ id: string; base_key: string; width: number; height: number }>(
          sql`
          SELECT sm.id, sm.base_key, sm.width, sm.height FROM product_images pi
          JOIN store_media sm ON sm.id = pi.media_id
          WHERE pi.product_id = ${productId} ORDER BY pi.position`,
        )
        .then((result) => result.rows),
      this.db
        .execute<{ created_at: Date; sale_price: string; original_price: string }>(
          sql`
          SELECT ph.created_at, ph.sale_price, ph.original_price FROM price_history ph
          WHERE ph.is_public AND ph.created_at > now() - interval '90 days'
            AND ph.variant_id = (SELECT id FROM product_variants WHERE product_id = ${productId} AND is_active ORDER BY created_at LIMIT 1)
          ORDER BY ph.created_at`,
        )
        .then((result) => result.rows),
    ]);
    const first = variants[0]!;
    const discount = Number(first.discount_percent);
    const original = Number(first.original_price);
    const reference = first.reference_price === null ? null : Number(first.reference_price);

    return {
      shortId: row.short_id as string,
      slug: row.slug as string,
      title: row.title as string,
      brand: row.brand_name
        ? { name: row.brand_name as string, slug: row.brand_slug as string }
        : null,
      category: {
        slug: row.cat_slug as string,
        name: { ru: row.cat_ru as string, kk: row.cat_kk as string },
        parent: row.par_slug
          ? {
              slug: row.par_slug as string,
              name: { ru: row.par_ru as string, kk: row.par_kk as string },
            }
          : null,
      },
      gender: row.gender as ProductDetail['gender'],
      color: first.color_code
        ? {
            code: first.color_code as string,
            name: { ru: first.color_ru as string, kk: first.color_kk as string },
            hex: (first.hex as string | null) ?? null,
          }
        : null,
      description: (row.description as string | null) ?? null,
      composition: (row.composition as string | null) ?? null,
      article: (first.article as string | null) ?? null,
      images: images.map((image) =>
        toMedia({
          id: image.id,
          baseKey: image.base_key,
          width: image.width,
          height: image.height,
        }),
      ),
      salePrice: Number(first.sale_price),
      originalPrice: original,
      referencePrice: reference !== null && reference < original ? reference : null,
      discountPercent: discount,
      sizes: variants.map((variant) => ({
        variantId: variant.id as string,
        id: (variant.size_value_id as number | null) ?? null,
        label: (variant.code as string | null) ?? null,
        available: Number(variant.available),
      })),
      available: variants.reduce((sum, variant) => sum + Number(variant.available), 0),
      store: {
        slug: row.store_slug as string,
        name: row.store_name as string,
        instagram: (row.instagram as string | null) ?? null,
        city: { ru: row.city_ru as string, kk: row.city_kk as string },
        address: row.address as string,
        phone: row.phone as string,
        schedule: row.schedule as PublicStore['schedule'],
        pickupEnabled: row.pickup_enabled as boolean,
      },
      priceHistory: dedupeHistory(history).map((point) => ({
        date: new Date(point.created_at).toISOString(),
        salePrice: Number(point.sale_price),
        originalPrice: Number(point.original_price),
      })),
      publishedAt: new Date(row.published_at as string).toISOString(),
      updatedAt: new Date(row.updated_at as string).toISOString(),
    };
  }

  async store(slug: string): Promise<PublicStore> {
    const [row] = await this.db
      .execute<Record<string, unknown>>(
        sql`
        SELECT s.slug, s.name, s.description, s.instagram, s.verified_at,
               c.name_ru, c.name_kk, sl.address, sl.phone, sl.schedule, sl.pickup_enabled,
               (SELECT count(*) FROM products p WHERE p.store_id = s.id AND p.status IN ('ACTIVE', 'FLAGGED'))::int AS product_count
        FROM stores s
        JOIN store_locations sl ON sl.store_id = s.id
        JOIN cities c ON c.id = sl.city_id
        WHERE s.slug = ${slug} AND s.status = 'VERIFIED'`,
      )
      .then((result) => result.rows);
    if (!row) throw new NotFoundException('Магазин не найден');
    return {
      slug: row.slug as string,
      name: row.name as string,
      description: (row.description as string | null) ?? null,
      instagram: (row.instagram as string | null) ?? null,
      city: { ru: row.name_ru as string, kk: row.name_kk as string },
      address: row.address as string,
      phone: row.phone as string,
      schedule: row.schedule as PublicStore['schedule'],
      pickupEnabled: row.pickup_enabled as boolean,
      productCount: Number(row.product_count),
      since: new Date(row.verified_at as string).toISOString(),
    };
  }

  async sitemap(): Promise<SitemapData> {
    const [products, stores] = await Promise.all([
      this.db
        .execute<{ slug: string; short_id: string; updated_at: Date }>(
          sql`
          SELECT p.slug, p.short_id, p.updated_at FROM products p JOIN stores s ON s.id = p.store_id
          WHERE ${VISIBLE} ORDER BY p.updated_at DESC LIMIT 45000`,
        )
        .then((result) => result.rows),
      this.db
        .execute<{ slug: string; updated_at: Date }>(
          sql`SELECT slug, updated_at FROM stores WHERE status = 'VERIFIED'`,
        )
        .then((result) => result.rows),
    ]);
    return {
      products: products.map((p) => ({
        slug: p.slug,
        shortId: p.short_id,
        updatedAt: new Date(p.updated_at).toISOString(),
      })),
      stores: stores.map((s) => ({
        slug: s.slug,
        updatedAt: new Date(s.updated_at).toISOString(),
      })),
    };
  }

  /** Conditions shared by results and filter options: visibility, category, gender, search. */
  private async scope(query: CatalogQuery): Promise<SQL[]> {
    const conditions: SQL[] = [VISIBLE];
    if (query.category) {
      const ids = await this.db
        .execute<{ id: number }>(
          sql`
          SELECT id FROM categories WHERE slug = ${query.category} AND is_active
          UNION SELECT child.id FROM categories child JOIN categories parent ON parent.id = child.parent_id
                WHERE parent.slug = ${query.category} AND child.is_active`,
        )
        .then((result) => result.rows.map((row) => row.id));
      if (ids.length === 0) throw new NotFoundException('Категория не найдена');
      conditions.push(sql`p.category_id IN (${list(ids)})`);
    }
    if (query.gender) conditions.push(sql`p.gender IN (${list(GENDERS[query.gender]!)})`);
    if (query.q) {
      const pattern = likePattern(query.q);
      conditions.push(sql`(lower(p.title) LIKE ${pattern} OR lower(b.name) LIKE ${pattern} OR lower(s.name) LIKE ${pattern}
        OR EXISTS (SELECT 1 FROM product_variants qv WHERE qv.product_id = p.id
                   AND lower(coalesce(qv.article, '') || ' ' || qv.sku) LIKE ${pattern}))`);
    }
    return conditions;
  }

  private async facets(scope: SQL[]): Promise<CatalogResponse['facets']> {
    const where = sql.join([...scope, sql`v.available > 0`], sql` AND `);
    const from = sql`FROM products p
      JOIN (${VARIANTS}) v ON v.product_id = p.id
      JOIN stores s ON s.id = p.store_id
      JOIN store_locations sl ON sl.store_id = s.id
      LEFT JOIN brands b ON b.id = p.brand_id`;
    const [brands, stores, sizes, colors, price] = await Promise.all([
      this.db.execute<{ value: string; label: string; count: number }>(sql`
        SELECT b.slug AS value, b.name AS label, count(*)::int AS count ${from}
        WHERE ${where} AND b.id IS NOT NULL GROUP BY b.slug, b.name ORDER BY count DESC, b.name LIMIT 50`),
      this.db.execute<{ value: string; label: string; count: number }>(sql`
        SELECT s.slug AS value, s.name AS label, count(*)::int AS count ${from}
        WHERE ${where} GROUP BY s.slug, s.name ORDER BY count DESC, s.name LIMIT 50`),
      this.db.execute<{ value: string; label: string; chart: string; count: number }>(sql`
        SELECT sz.id::text AS value, sz.code AS label, ch.code AS chart, count(DISTINCT p.id)::int AS count ${from}
        JOIN product_variants fv ON fv.product_id = p.id AND fv.is_active
        JOIN inventory fi ON fi.variant_id = fv.id AND fi.available > 0
        JOIN size_values sz ON sz.id = fv.size_value_id
        JOIN size_charts ch ON ch.id = sz.chart_id
        WHERE ${where} GROUP BY sz.id, sz.code, ch.code, ch.id, sz.position ORDER BY ch.id, sz.position`),
      this.db.execute<{
        value: string;
        label: string;
        label_kk: string;
        hex: string | null;
        count: number;
      }>(sql`
        SELECT co.code AS value, co.name_ru AS label, co.name_kk AS label_kk, co.hex, count(DISTINCT p.id)::int AS count ${from}
        JOIN product_variants cv ON cv.product_id = p.id AND cv.is_active
        JOIN colors co ON co.id = cv.color_id
        WHERE ${where} GROUP BY co.code, co.name_ru, co.name_kk, co.hex, co.id ORDER BY co.id`),
      this.db.execute<{ min: string | null; max: string | null }>(sql`
        SELECT min(v.sale_price) AS min, max(v.sale_price) AS max ${from} WHERE ${where}`),
    ]);
    const range = price.rows[0];
    return {
      brands: brands.rows,
      stores: stores.rows,
      sizes: sizes.rows,
      colors: colors.rows.map(({ label_kk, ...color }) => ({ ...color, labelKk: label_kk })),
      price: range?.min
        ? { min: Math.floor(Number(range.min) / 100), max: Math.ceil(Number(range.max) / 100) }
        : null,
    };
  }

  private toCard(row: CardRow): CatalogCard {
    return {
      shortId: row.short_id,
      slug: row.slug,
      title: row.title,
      brand: row.brand,
      image: row.base_key
        ? toMedia({
            id: row.media_id!,
            baseKey: row.base_key,
            width: row.width!,
            height: row.height!,
          })
        : null,
      salePrice: Number(row.sale_price),
      originalPrice: Number(row.original_price),
      discountPercent: Number(row.discount_percent),
      available: Number(row.available),
      sizes: row.sizes,
      store: {
        slug: row.store_slug,
        name: row.store_name,
        city: { ru: row.city_ru, kk: row.city_kk },
      },
    };
  }
}

/** One point per price change (publishing twice at the same price is not a change). */
function dedupeHistory<T extends { sale_price: string; original_price: string }>(rows: T[]): T[] {
  return rows.filter((row, index) => {
    const previous = rows[index - 1];
    return (
      !previous ||
      previous.sale_price !== row.sale_price ||
      previous.original_price !== row.original_price
    );
  });
}
