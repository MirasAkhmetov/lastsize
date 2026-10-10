import type { ImportRowData } from '@lastsize/db';
import {
  discountPercent,
  guessCategorySlug,
  guessColorCode,
  guessGender,
  matchSizeCode,
  priceProblems,
} from '@lastsize/domain';

export type ChartCode = 'CLOTHING_INT' | 'SHOES_EU' | 'KIDS_HEIGHT';
type Gender = 'WOMEN' | 'MEN' | 'UNISEX' | 'KIDS';
type MappingKind = 'CATEGORY' | 'COLOR' | 'SIZE';

/** Reference data and the store's remembered choices, loaded once per operation. */
export interface CatalogContext {
  categories: Map<
    number,
    { slug: string; rootSlug: string; chart: ChartCode | null; usable: boolean }
  >;
  categoryBySlug: Map<string, number>;
  colorByCode: Map<string, number>;
  colorIds: Set<number>;
  charts: Map<ChartCode, { id: number; code: string }[]>;
  minDiscount: number;
  /** Key: mappingKey(kind, value). */
  mappings: Map<string, number>;
}

export function mappingKey(kind: MappingKind, value: string, chart?: ChartCode): string {
  return `${kind}:${chart ? `${chart}:` : ''}${value.trim().toLowerCase()}`;
}

export function chartFor(
  context: CatalogContext,
  categoryId: number | null,
  gender: Gender | null,
): ChartCode | null | undefined {
  if (categoryId === null) return undefined;
  const category = context.categories.get(categoryId);
  if (!category) return undefined;
  if (category.rootSlug === 'clothing' && gender === 'KIDS') return 'KIDS_HEIGHT';
  return category.chart;
}

export interface RowState {
  data: ImportRowData;
  categoryId: number | null;
  gender: Gender | null;
  colorId: number | null;
  sizeMap: Record<string, number | null>;
  mediaIds: string[];
  originalPrice: number | null;
  salePrice: number | null;
  externalPrice: number | null;
}

export const sizeKey = (label: string | null) => label ?? '';

/** First guesses for a new row: the store's remembered choices win over keyword guesses. */
export function initialGuesses(
  context: CatalogContext,
  data: ImportRowData,
): Pick<RowState, 'categoryId' | 'gender' | 'colorId'> {
  const remembered = (kind: MappingKind, value: string | null) =>
    value ? (context.mappings.get(mappingKey(kind, value)) ?? null) : null;
  const slug = guessCategorySlug(data.sourceCategory, data.title);
  let categoryId =
    remembered('CATEGORY', data.sourceCategory) ??
    (slug ? (context.categoryBySlug.get(slug) ?? null) : null);
  if (categoryId !== null && !context.categories.get(categoryId)?.usable) categoryId = null;
  const colorCode = guessColorCode(data.sourceColor, data.title);
  const colorId =
    remembered('COLOR', data.sourceColor) ??
    (colorCode ? (context.colorByCode.get(colorCode) ?? null) : null);
  return {
    categoryId,
    gender: guessGender(data.sourceGender, data.title, data.sourceCategory),
    colorId,
  };
}

/** Variants to create: sizes merged by match, one-size goods collapsed into one variant. */
export function variantsOf(
  state: RowState,
  chart: ChartCode | null,
): {
  sizeValueId: number | null;
  quantity: number;
  externalSizeId: string | null;
  barcode: string | null;
}[] {
  const merged = new Map<
    number | null,
    { quantity: number; externalSizeId: string | null; barcode: string | null }
  >();
  for (const size of state.data.sizes) {
    const id = chart === null ? null : (state.sizeMap[sizeKey(size.label)] ?? undefined);
    if (id === undefined) continue;
    const entry = merged.get(id) ?? {
      quantity: 0,
      externalSizeId: size.externalSizeId,
      barcode: size.barcode,
    };
    entry.quantity = Math.min(entry.quantity + size.quantity, 9_999);
    merged.set(id, entry);
  }
  return [...merged].map(([sizeValueId, entry]) => ({ sizeValueId, ...entry }));
}

/**
 * Fills size matches for the row's size chart and lists what blocks publishing. Matches the
 * seller made are kept while they fit the chart.
 */
export function evaluateRow(
  context: CatalogContext,
  state: RowState,
): { sizeMap: Record<string, number | null>; issues: string[]; chart: ChartCode | null } {
  const issues: string[] = [];
  const category = state.categoryId !== null ? context.categories.get(state.categoryId) : undefined;
  if (!category?.usable) issues.push('category.required');
  if (!state.gender) issues.push('gender.required');
  if (state.colorId === null || !context.colorIds.has(state.colorId)) issues.push('color.required');
  if (!state.data.brand) issues.push('brand.required');
  if (state.data.title.trim().length < 2) issues.push('title.tooShort');

  const chart = category?.usable ? chartFor(context, state.categoryId, state.gender) : undefined;
  const sizeMap: Record<string, number | null> = {};
  if (chart) {
    const values = context.charts.get(chart) ?? [];
    const ids = new Set(values.map((value) => value.id));
    for (const size of state.data.sizes) {
      const key = sizeKey(size.label);
      const current = state.sizeMap[key];
      if (current != null && ids.has(current)) {
        sizeMap[key] = current;
        continue;
      }
      const remembered = size.label
        ? context.mappings.get(mappingKey('SIZE', size.label, chart))
        : undefined;
      if (remembered !== undefined && ids.has(remembered)) {
        sizeMap[key] = remembered;
        continue;
      }
      const code = matchSizeCode(
        size.label,
        chart,
        values.map((value) => value.code),
      );
      sizeMap[key] = values.find((value) => value.code === code)?.id ?? null;
    }
    if (state.data.sizes.some((size) => size.quantity > 0 && sizeMap[sizeKey(size.label)] == null))
      issues.push('sizes.unmapped');
  }
  if (chart !== undefined) {
    const stock = variantsOf({ ...state, sizeMap }, chart).reduce((sum, v) => sum + v.quantity, 0);
    if (stock === 0) issues.push('stock.required');
  }

  if (state.data.photos.length === 0 && state.mediaIds.length === 0) issues.push('images.required');
  if (state.originalPrice === null) issues.push('price.required');
  else if (state.salePrice === null) issues.push('price.saleRequired');
  else
    issues.push(
      ...priceProblems(
        {
          originalPrice: state.originalPrice,
          salePrice: state.salePrice,
          externalPrice: state.externalPrice,
        },
        context.minDiscount,
        'publish',
      ),
    );
  return { sizeMap, issues, chart: chart ?? null };
}

export function rowDiscount(
  state: Pick<RowState, 'originalPrice' | 'salePrice' | 'externalPrice'>,
) {
  if (state.originalPrice === null || state.salePrice === null) return null;
  return discountPercent({
    originalPrice: state.originalPrice,
    salePrice: state.salePrice,
    externalPrice: state.externalPrice,
  });
}
