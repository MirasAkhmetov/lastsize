import 'server-only';
import {
  type AdminStoreDetail,
  adminStoreDetailSchema,
  type AdminStoreList,
  adminStoreListSchema,
  type AdminUserList,
  adminUserListSchema,
  type MeResponse,
  meResponseSchema,
  type ProductList,
  productListSchema,
  type StoreStatus,
  type AdminOrderDetail,
  adminOrderDetailSchema,
  type AdminOrderList,
  adminOrderListSchema,
  type BlockedPhone,
  blockedPhoneListSchema,
  type IntegrationHealth,
  integrationHealthListSchema,
  type PlatformAnalytics,
  platformAnalyticsSchema,
  type SellerOrderStatus,
  type SuspiciousPhone,
  suspiciousPhoneListSchema,
} from '@lastsize/contracts';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { z } from 'zod';
import { serverEnv } from './env';

async function apiGet<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
): Promise<z.output<TSchema> | null> {
  const store = await cookies();
  const session = store.getAll().filter((cookie) => /^(__Host-)?sid$/.test(cookie.name));
  const response = await fetch(`${serverEnv.API_INTERNAL_URL}/api/v1${path}`, {
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      ...(session.length ? { cookie: session.map((c) => `${c.name}=${c.value}`).join('; ') } : {}),
    },
  });
  if (response.status === 401 || response.status === 404) return null;
  if (response.status === 403) redirect('/mfa');
  if (!response.ok) throw new Error(`API ${path} responded ${response.status}`);
  return schema.parse(await response.json());
}

export function getMe(): Promise<MeResponse | null> {
  return apiGet('/auth/me', meResponseSchema);
}

export function getUsers(limit: number, offset: number): Promise<AdminUserList | null> {
  return apiGet(`/admin/users?limit=${limit}&offset=${offset}`, adminUserListSchema);
}

/** Where a signed-in account must go before it can use the panel. */
export function staffGate(me: MeResponse | null): '/login' | '/denied' | '/mfa' | null {
  if (!me) return '/login';
  if (!me.permissions.includes('admin:access')) return '/denied';
  if (!me.mfa.verified) return '/mfa';
  return null;
}

export function getStores(
  status: StoreStatus,
  limit: number,
  offset: number,
): Promise<AdminStoreList | null> {
  return apiGet(
    `/admin/stores?status=${status}&limit=${limit}&offset=${offset}`,
    adminStoreListSchema,
  );
}

export function getStore(storeId: string): Promise<AdminStoreDetail | null> {
  return apiGet(`/admin/stores/${encodeURIComponent(storeId)}`, adminStoreDetailSchema);
}

export function getProductFeed(
  filter: 'flagged' | 'recent' | 'removed',
  limit: number,
  offset: number,
): Promise<ProductList | null> {
  return apiGet(
    `/admin/products?filter=${filter}&limit=${limit}&offset=${offset}`,
    productListSchema,
  );
}

export function getAnalytics(days: number): Promise<PlatformAnalytics | null> {
  return apiGet(`/admin/analytics?days=${days}`, platformAnalyticsSchema);
}

export function getOrders(
  status: SellerOrderStatus | undefined,
  query: string | undefined,
  limit: number,
  offset: number,
): Promise<AdminOrderList | null> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (status) params.set('status', status);
  if (query) params.set('q', query);
  return apiGet(`/admin/orders?${params}`, adminOrderListSchema);
}

export function getOrder(id: string): Promise<AdminOrderDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Promise.resolve(null);
  return apiGet(`/admin/orders/${id}`, adminOrderDetailSchema);
}

export async function getSuspiciousPhones(): Promise<SuspiciousPhone[]> {
  return (await apiGet('/admin/phones/suspicious', suspiciousPhoneListSchema)) ?? [];
}

export async function getBlockedPhones(): Promise<BlockedPhone[]> {
  return (await apiGet('/admin/phones/blocked', blockedPhoneListSchema)) ?? [];
}

export async function getIntegrationHealth(): Promise<IntegrationHealth[]> {
  return (await apiGet('/admin/integrations', integrationHealthListSchema)) ?? [];
}
