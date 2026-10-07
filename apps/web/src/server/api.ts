import 'server-only';
import {
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
