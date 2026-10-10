import { type CatalogQuery, catalogQuerySchema } from '@lastsize/contracts';

const FILTER_KEYS = [
  'store',
  'brand',
  'size',
  'color',
  'priceMin',
  'priceMax',
  'discount',
  'pickup',
  'q',
  'sort',
  'page',
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

/**
 * Reads catalog filters from the page URL. Each parameter is validated on its own and
 * malformed ones are dropped, so a mistyped link still shows a catalog instead of an error.
 */
export function parseCatalogParams(
  searchParams: Record<string, string | string[] | undefined>,
): Partial<CatalogQuery> {
  const result: Record<string, unknown> = {};
  for (const key of FILTER_KEYS) {
    const raw = searchParams[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined || value === '') continue;
    const parsed = catalogQuerySchema.shape[key].safeParse(value);
    if (parsed.success && parsed.data !== undefined) result[key] = parsed.data;
  }
  return result as Partial<CatalogQuery>;
}

/** True when the page shows a filtered or searched subset (such pages are not indexed). */
export function hasFilters(query: Partial<CatalogQuery>): boolean {
  return FILTER_KEYS.some((key) => key !== 'page' && key !== 'sort' && query[key] !== undefined);
}
