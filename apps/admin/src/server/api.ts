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
  type StoreStatus,
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
