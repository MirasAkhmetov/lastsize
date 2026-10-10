import { z } from 'zod';
import { mediaSchema } from './products.js';

/** Comma-separated list in a query string: "38,39" → ["38", "39"]. */
const csv = (item: z.ZodString, max = 30) =>
  z
    .string()
    .max(1000)
    .transform((value) =>
      value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item).max(max));

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(80);

export const CATALOG_SORTS = [
  'newest',
  'discount',
  'price_asc',
  'price_desc',
  'last_sizes',
] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

export const CATALOG_GENDERS = ['women', 'men', 'kids'] as const;
export type CatalogGender = (typeof CATALOG_GENDERS)[number];

export const CATALOG_PAGE_SIZE = 24;

/** Catalog filters as they appear in the URL. Prices are in whole tenge. */
export const catalogQuerySchema = z.object({
  category: slug.optional(),
  gender: z.enum(CATALOG_GENDERS).optional(),
  store: csv(slug).optional(),
  brand: csv(slug).optional(),
  size: csv(z.string().regex(/^\d{1,5}$/)).optional(),
  color: csv(slug).optional(),
  priceMin: z.coerce.number().int().min(0).max(100_000_000).optional(),
  priceMax: z.coerce.number().int().min(0).max(100_000_000).optional(),
  discount: z.coerce
    .number()
    .int()
    .refine((value) => [30, 50, 70].includes(value))
    .optional(),
  pickup: z.enum(['1']).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(CATALOG_SORTS).default('newest'),
  page: z.coerce.number().int().min(1).max(100).default(1),
});
export type CatalogQuery = z.output<typeof catalogQuerySchema>;

const localized = z.object({ ru: z.string(), kk: z.string() });

export const catalogCardSchema = z.object({
  shortId: z.string(),
  slug: z.string(),
  title: z.string(),
  brand: z.string().nullable(),
  image: mediaSchema.nullable(),
  salePrice: z.number().int(),
  originalPrice: z.number().int(),
  discountPercent: z.number().int(),
  available: z.number().int(),
  sizes: z.array(
    z.object({
      id: z.number().int().nullable(),
      label: z.string().nullable(),
      available: z.number().int(),
    }),
  ),
  store: z.object({ slug: z.string(), name: z.string(), city: localized }),
});
export type CatalogCard = z.infer<typeof catalogCardSchema>;

const facet = z.object({ value: z.string(), label: z.string(), count: z.number().int() });

export const catalogResponseSchema = z.object({
  items: z.array(catalogCardSchema),
  total: z.number().int(),
  page: z.number().int(),
  pages: z.number().int(),
  /** Options for filters, counted within the current category, gender and search. */
  facets: z.object({
    brands: z.array(facet),
    stores: z.array(facet),
    sizes: z.array(facet.extend({ chart: z.string() })),
    colors: z.array(facet.extend({ hex: z.string().nullable(), labelKk: z.string() })),
    price: z.object({ min: z.number().int(), max: z.number().int() }).nullable(),
  }),
});
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;

export const publicStoreSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  instagram: z.string().nullable(),
  city: localized,
  address: z.string(),
  phone: z.string(),
  schedule: z.record(z.string(), z.array(z.tuple([z.string(), z.string()]))),
  pickupEnabled: z.boolean(),
  productCount: z.number().int(),
  since: z.iso.datetime({ offset: true }),
});
export type PublicStore = z.infer<typeof publicStoreSchema>;

export const productDetailSchema = z.object({
  shortId: z.string(),
  slug: z.string(),
  title: z.string(),
  brand: z.object({ name: z.string(), slug: z.string() }).nullable(),
  category: z.object({
    slug: z.string(),
    name: localized,
    parent: z.object({ slug: z.string(), name: localized }).nullable(),
  }),
  gender: z.enum(['WOMEN', 'MEN', 'UNISEX', 'KIDS']),
  color: z.object({ code: z.string(), name: localized, hex: z.string().nullable() }).nullable(),
  description: z.string().nullable(),
  composition: z.string().nullable(),
  article: z.string().nullable(),
  images: z.array(mediaSchema),
  salePrice: z.number().int(),
  originalPrice: z.number().int(),
  /** Lowest public price of the last 30 days when it limits the discount. */
  referencePrice: z.number().int().nullable(),
  discountPercent: z.number().int(),
  sizes: z.array(
    z.object({
      variantId: z.uuid(),
      id: z.number().int().nullable(),
      label: z.string().nullable(),
      available: z.number().int(),
    }),
  ),
  available: z.number().int(),
  store: publicStoreSchema.omit({ productCount: true, since: true, description: true }),
  /** Public prices of the last 90 days, one point per change. */
  priceHistory: z.array(
    z.object({
      date: z.iso.datetime({ offset: true }),
      salePrice: z.number().int(),
      originalPrice: z.number().int(),
    }),
  ),
  publishedAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type ProductDetail = z.infer<typeof productDetailSchema>;

export const sitemapSchema = z.object({
  products: z.array(
    z.object({
      slug: z.string(),
      shortId: z.string(),
      updatedAt: z.iso.datetime({ offset: true }),
    }),
  ),
  stores: z.array(z.object({ slug: z.string(), updatedAt: z.iso.datetime({ offset: true }) })),
});
export type SitemapData = z.infer<typeof sitemapSchema>;

/** /product/nike-air-max-270-k7f2q9mx → "k7f2q9mx". */
export function shortIdFromProductPath(slugAndId: string): string | null {
  const match = /(?:^|-)([0-9a-z]{8})$/.exec(slugAndId);
  return match ? match[1]! : null;
}

export function productPath(product: { slug: string; shortId: string }): string {
  return `/product/${product.slug}-${product.shortId}`;
}
