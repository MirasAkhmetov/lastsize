import { storeLocations, storeMembers, stores, userRoles } from '@lastsize/db';
import * as OTPAuth from 'otpauth';
import { expect } from 'vitest';
import { cookieHeader, type Harness, uniquePhone } from './harness';

export const PASSWORD = 'correct-horse-battery';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
export interface RequestOptions {
  cookie?: string;
  body?: unknown;
  headers?: Record<string, string>;
  ip?: string;
}

/** Test client bound to one harness: plain requests and ready-made accounts. */
export function createClient(h: Harness) {
  let ipCounter = 0;

  /** Each request comes from its own client IP unless a test pins one, so per-IP limits do not interfere. */
  const json = (method: Method, url: string, options: RequestOptions = {}) =>
    h.app.inject({
      method,
      url,
      remoteAddress: options.ip ?? `10.0.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`,
      headers: { ...(options.cookie ? { cookie: options.cookie } : {}), ...options.headers },
      ...(options.body !== undefined ? { payload: options.body as object } : {}),
    });

  async function register(phone = uniquePhone(), name = 'Асель') {
    const response = await json('POST', '/api/v1/auth/register', {
      body: { phone, name, password: PASSWORD },
    });
    expect(response.statusCode).toBe(201);
    return {
      phone,
      cookie: cookieHeader(response),
      userId: response.json().user.id as string,
      response,
    };
  }

  const login = (phone: string, password = PASSWORD) =>
    json('POST', '/api/v1/auth/login', { body: { phone, password } });

  /** Inserts a store directly, bypassing the API (for access-control tests). */
  async function createStoreFor(userId: string, role: 'SELLER' | 'SELLER_MANAGER' = 'SELLER') {
    const suffix = Math.random().toString(36).slice(2, 8);
    const [store] = await h.database.db
      .insert(stores)
      .values({ slug: `store-${suffix}`, name: `Store ${suffix}`, binIin: '971240001315' })
      .returning();
    await h.database.db.insert(storeLocations).values({
      storeId: store!.id,
      cityId: 1,
      address: 'Абая 52',
      schedule: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
      phone: '+77011234567',
    });
    await h.database.db.insert(storeMembers).values({ storeId: store!.id, userId, role });
    return store!;
  }

  /** A staff account signed in with password only (TOTP not yet passed). */
  async function makeStaff(role: 'ADMIN' | 'SUPER_ADMIN' = 'ADMIN') {
    const account = await register();
    await h.database.db.insert(userRoles).values({ userId: account.userId, roleCode: role });
    const response = await login(account.phone);
    return { ...account, cookie: cookieHeader(response) };
  }

  /** A staff account that enrolled TOTP; its session can use the admin API. */
  async function makeVerifiedStaff(role: 'ADMIN' | 'SUPER_ADMIN' = 'ADMIN') {
    const staff = await makeStaff(role);
    const setup = await json('POST', '/api/v1/auth/mfa/setup', { cookie: staff.cookie });
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(setup.json().secret),
      digits: 6,
      period: 30,
    });
    const activated = await json('POST', '/api/v1/auth/mfa/activate', {
      cookie: staff.cookie,
      body: { code: totp.generate() },
    });
    expect(activated.statusCode).toBe(200);
    return { ...staff, totp };
  }

  return { json, register, login, createStoreFor, makeStaff, makeVerifiedStaff };
}
