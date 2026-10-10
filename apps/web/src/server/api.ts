import 'server-only';
import {
  type CatalogQuery,
  type CatalogResponse,
  catalogResponseSchema,
  type ProductDetail,
  productDetailSchema,
  type PublicStore,
  publicStoreSchema,
  type SitemapData,
  sitemapSchema,
  type Color,
  colorListSchema,
  minDiscountSchema,
  type ProductList,
  productListSchema,
  type SellerProduct,
  sellerProductSchema,
  type SizeChart,
  sizeChartListSchema,
  type Category,
  categoryTreeSchema,
  type City,
  cityListSchema,
  type MeResponse,
  meResponseSchema,
  type SellerStore,
  sellerStoreSchema,
  type StoreDetail,
  storeDetailSchema,
} from '@lastsize/contracts';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { serverEnv } from './env';

/** Server-to-server call to the API. Only the session cookies are forwarded, nothing else. */
async function apiGet<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
  options: { withSession?: boolean; revalidate?: number } = {},
): Promise<z.output<TSchema> | null> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.withSession) {
    const store = await cookies();
    const sessionCookies = store
      .getAll()
      .filter((cookie) => /^(__Host-)?(sid|gsid)$/.test(cookie.name))
      .map((cookie) => `${cookie.name}=${cookie.value}`);
    if (sessionCookies.length > 0) headers.cookie = sessionCookies.join('; ');
  }
  const response = await fetch(`${serverEnv.API_INTERNAL_URL}/api/v1${path}`, {
    headers,
    ...(options.withSession
      ? { cache: 'no-store' as const }
      : { next: { revalidate: options.revalidate ?? 300 } }),
  });
  if (response.status === 401 || response.status === 404) return null;
  if (!response.ok) throw new Error(`API ${path} responded ${response.status}`);
  return schema.parse(await response.json());
}

/** The signed-in seller or staff member, or null. */
export function getMe(): Promise<MeResponse | null> {
  return apiGet('/auth/me', meResponseSchema, { withSession: true });
}

/**
 * Category tree for navigation. If the API is unreachable (e.g. during a Docker build),
 * the page renders without categories and fills them in on the next revalidation.
 */
export async function getCategories(): Promise<Category[]> {
  try {
    return (await apiGet('/categories', categoryTreeSchema, { revalidate: 300 })) ?? [];
  } catch {
    return [];
  }
}

export async function getCities(): Promise<City[]> {
  return (await apiGet('/cities', cityListSchema, { revalidate: 3600 })) ?? [];
}

/** All stores of the signed-in seller, including rejected and blocked ones with the reason. */
export async function getMyStores(): Promise<SellerStore[]> {
  return (await apiGet('/seller/stores', z.array(sellerStoreSchema), { withSession: true })) ?? [];
}

export function getMyStore(storeId: string): Promise<StoreDetail | null> {
  return apiGet(`/seller/stores/${encodeURIComponent(storeId)}`, storeDetailSchema, {
    withSession: true,
  });
}

export async function getSizeCharts(): Promise<SizeChart[]> {
  return (await apiGet('/size-charts', sizeChartListSchema, { revalidate: 3600 })) ?? [];
}

export async function getColors(): Promise<Color[]> {
  return (await apiGet('/colors', colorListSchema, { revalidate: 3600 })) ?? [];
}

export async function getMinDiscount(): Promise<number> {
  return (
    (await apiGet('/settings/min-discount', minDiscountSchema, { revalidate: 60 }))
      ?.minDiscountPercent ?? 30
  );
}

export async function getMyProducts(storeId: string): Promise<ProductList> {
  return (
    (await apiGet(
      `/seller/stores/${encodeURIComponent(storeId)}/products?limit=100`,
      productListSchema,
      { withSession: true },
    )) ?? {
      items: [],
      total: 0,
    }
  );
}

export function getMyProduct(storeId: string, productId: string): Promise<SellerProduct | null> {
  return apiGet(
    `/seller/stores/${encodeURIComponent(storeId)}/products/${encodeURIComponent(productId)}`,
    sellerProductSchema,
    {
      withSession: true,
    },
  );
}

/** Turns parsed catalog filters back into the API query string. */
export function catalogSearchParams(query: Partial<CatalogQuery>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return params;
}

export async function getCatalog(query: Partial<CatalogQuery>): Promise<CatalogResponse | null> {
  return apiGet(`/catalog/products?${catalogSearchParams(query)}`, catalogResponseSchema, {
    revalidate: 30,
  });
}

export function getProduct(shortId: string): Promise<ProductDetail | null> {
  return apiGet(`/catalog/products/${encodeURIComponent(shortId)}`, productDetailSchema, {
    revalidate: 30,
  });
}

export function getPublicStore(slug: string): Promise<PublicStore | null> {
  return apiGet(`/stores/${encodeURIComponent(slug)}`, publicStoreSchema, { revalidate: 60 });
}

export async function getSitemapData(): Promise<SitemapData> {
  return (
    (await apiGet('/catalog/sitemap', sitemapSchema, { revalidate: 600 })) ?? {
      products: [],
      stores: [],
    }
  );
}
