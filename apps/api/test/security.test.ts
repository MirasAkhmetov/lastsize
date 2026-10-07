import { auditLogs, eq, stores, users } from '@lastsize/db';
import * as OTPAuth from 'otpauth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, PASSWORD } from './client';
import {
  ALLOWED_ORIGIN,
  cookieHeader,
  type Harness,
  integrationEnabled,
  startHarness,
  uniquePhone,
} from './harness';

describe.runIf(integrationEnabled)('authentication and authorization', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  let json: ReturnType<typeof createClient>['json'];
  let register: ReturnType<typeof createClient>['register'];
  let login: ReturnType<typeof createClient>['login'];
  let createStoreFor: ReturnType<typeof createClient>['createStoreFor'];
  let makeStaff: ReturnType<typeof createClient>['makeStaff'];
  beforeAll(() => {
    ({ json, register, login, createStoreFor, makeStaff } = createClient(h));
  });

  describe('sessions', () => {
    it('rejects anonymous access to every protected area', async () => {
      for (const url of ['/api/v1/auth/me', '/api/v1/admin/users', '/api/v1/seller/stores']) {
        const response = await json('GET', url);
        expect(response.statusCode, url).toBe(401);
        expect(response.json().code).toBe('UNAUTHORIZED');
      }
    });

    it('issues an HttpOnly, SameSite=Lax session cookie and never returns secrets', async () => {
      const { response, cookie } = await register();
      const session = response.cookies.find((c) => c.name === 'sid');
      expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
      expect(response.body).not.toMatch(/password|hash|totp|secret/i);

      const me = await json('GET', '/api/v1/auth/me', { cookie });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({ roles: [], stores: [], mfa: { required: false } });
    });

    it('stores passwords as argon2id hashes', async () => {
      const { userId } = await register();
      const [row] = await h.database.db
        .select({ hash: users.passwordHash })
        .from(users)
        .where(eq(users.id, userId));
      expect(row!.hash).toMatch(/^\$argon2id\$/);
      expect(row!.hash).not.toContain(PASSWORD);
    });

    it('treats differently formatted numbers as the same phone', async () => {
      const phone = '+77017778899';
      await register(phone);
      const duplicate = await json('POST', '/api/v1/auth/register', {
        body: { phone: '8 (701) 777-88-99', name: 'Другой', password: PASSWORD },
      });
      expect(duplicate.statusCode).toBe(409);
      expect((await login('8 701 777 88 99')).statusCode).toBe(200);
    });

    it('validates input and rejects unknown fields', async () => {
      const weak = await json('POST', '/api/v1/auth/register', {
        body: { phone: uniquePhone(), name: 'A', password: 'short' },
      });
      expect(weak.statusCode).toBe(422);
      expect(
        weak
          .json()
          .errors.map((e: { path: string }) => e.path)
          .sort(),
      ).toEqual(['name', 'password']);

      const extra = await json('POST', '/api/v1/auth/register', {
        body: { phone: uniquePhone(), name: 'Асель', password: PASSWORD, roles: ['SUPER_ADMIN'] },
      });
      expect(extra.statusCode).toBe(422);
    });

    it('gives the same answer for a wrong password and an unknown phone', async () => {
      const { phone } = await register();
      const wrong = await login(phone, 'wrong-password-123');
      const unknown = await login(uniquePhone(), 'wrong-password-123');
      expect(wrong.statusCode).toBe(401);
      expect(unknown.statusCode).toBe(401);
      expect(wrong.json().detail).toBe(unknown.json().detail);
    });

    it('locks the phone after 5 wrong passwords, even for the right one', async () => {
      const { phone, userId } = await register();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await login(phone, `wrong-password-${attempt}`)).statusCode).toBe(401);
      }
      const locked = await login(phone);
      expect(locked.statusCode).toBe(429);
      expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);

      const audit = await h.database.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.actorId, userId));
      expect(audit.map((entry) => entry.action)).toContain('auth.login.locked');
      expect(JSON.stringify(audit)).not.toContain('wrong-password');
    });

    it('limits sign-ups from one IP address', async () => {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const response = await json('POST', '/api/v1/auth/register', {
          ip: '203.0.113.7',
          body: { phone: uniquePhone(), name: 'Спамер', password: PASSWORD },
        });
        statuses.push(response.statusCode);
      }
      expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    });

    it('revokes the session on logout', async () => {
      const { cookie } = await register();
      expect((await json('POST', '/api/v1/auth/logout', { cookie })).statusCode).toBe(204);
      expect((await json('GET', '/api/v1/auth/me', { cookie })).statusCode).toBe(401);
    });

    it('replaces the session on login (no session fixation)', async () => {
      const { phone, cookie: oldCookie } = await register();
      const response = await json('POST', '/api/v1/auth/login', {
        cookie: oldCookie,
        body: { phone, password: PASSWORD },
      });
      const newCookie = cookieHeader(response);
      expect(newCookie).not.toBe(oldCookie);
      expect((await json('GET', '/api/v1/auth/me', { cookie: oldCookie })).statusCode).toBe(401);
      expect((await json('GET', '/api/v1/auth/me', { cookie: newCookie })).statusCode).toBe(200);
    });

    it('cuts off a blocked user immediately and refuses new logins', async () => {
      const { phone, cookie, userId } = await register();
      await h.database.db.update(users).set({ status: 'BLOCKED' }).where(eq(users.id, userId));
      expect((await json('GET', '/api/v1/auth/me', { cookie })).statusCode).toBe(401);
      expect((await login(phone)).statusCode).toBe(403);
    });
  });

  describe('admin area', () => {
    it('is closed to guests with a customer cookie', async () => {
      const guest = await json('PATCH', '/api/v1/customer/me', { body: { name: 'Гость' } });
      expect(guest.statusCode).toBe(200);
      const response = await json('GET', '/api/v1/admin/users', { cookie: cookieHeader(guest) });
      expect(response.statusCode).toBe(401);
    });

    it('is closed to sellers', async () => {
      const seller = await register();
      await createStoreFor(seller.userId);
      const response = await json('GET', '/api/v1/admin/users', { cookie: seller.cookie });
      expect(response.statusCode).toBe(403);
    });

    it('requires the authenticator code even with the right password', async () => {
      const admin = await makeStaff();
      const blocked = await json('GET', '/api/v1/admin/users', { cookie: admin.cookie });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().detail).toMatch(/код/);

      const setup = await json('POST', '/api/v1/auth/mfa/setup', { cookie: admin.cookie });
      expect(setup.statusCode).toBe(200);
      const totp = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(setup.json().secret),
        digits: 6,
        period: 30,
      });
      const code = totp.generate();

      const activated = await json('POST', '/api/v1/auth/mfa/activate', {
        cookie: admin.cookie,
        body: { code },
      });
      expect(activated.statusCode).toBe(200);
      expect(activated.json().mfa).toEqual({ required: true, enrolled: true, verified: true });

      const users = await json('GET', '/api/v1/admin/users?limit=5', { cookie: admin.cookie });
      expect(users.statusCode).toBe(200);
      expect(users.body).not.toMatch(/password|hash|totp/i);

      // A new session must pass TOTP again, and an already used code is refused.
      const second = cookieHeader(await login(admin.phone));
      expect((await json('GET', '/api/v1/admin/users', { cookie: second })).statusCode).toBe(403);
      expect(
        (await json('POST', '/api/v1/auth/mfa/verify', { cookie: second, body: { code } }))
          .statusCode,
      ).toBe(401);
      const nextCode = totp.generate({ timestamp: Date.now() + 30_000 });
      expect(
        (
          await json('POST', '/api/v1/auth/mfa/verify', {
            cookie: second,
            body: { code: nextCode },
          })
        ).statusCode,
      ).toBe(200);
      expect((await json('GET', '/api/v1/admin/users', { cookie: second })).statusCode).toBe(200);
    });

    it('stores the TOTP seed encrypted', async () => {
      const admin = await makeStaff();
      const setup = await json('POST', '/api/v1/auth/mfa/setup', { cookie: admin.cookie });
      const secret = setup.json().secret as string;
      const totp = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(secret),
        digits: 6,
        period: 30,
      });
      await json('POST', '/api/v1/auth/mfa/activate', {
        cookie: admin.cookie,
        body: { code: totp.generate() },
      });
      const [row] = await h.database.db
        .select({ sealed: users.totpSecretEncrypted })
        .from(users)
        .where(eq(users.id, admin.userId));
      expect(row!.sealed).toMatch(/^v1\./);
      expect(row!.sealed).not.toContain(secret);
    });

    it('does not offer TOTP setup to non-staff accounts', async () => {
      const { cookie } = await register();
      expect((await json('POST', '/api/v1/auth/mfa/setup', { cookie })).statusCode).toBe(403);
    });
  });

  describe('store isolation', () => {
    it('shows a seller only their own stores', async () => {
      const a = await register();
      const b = await register();
      const storeA = await createStoreFor(a.userId);
      const storeB = await createStoreFor(b.userId);

      const mine = await json('GET', '/api/v1/seller/stores', { cookie: a.cookie });
      expect(mine.json().map((store: { id: string }) => store.id)).toEqual([storeA.id]);

      expect(
        (await json('GET', `/api/v1/seller/stores/${storeA.id}`, { cookie: a.cookie })).statusCode,
      ).toBe(200);
      // Another seller's store, a random id and garbage all look the same: not found.
      for (const id of [
        storeB.id,
        '01a10cbc-0000-7000-8000-000000000000',
        'not-a-uuid',
        "1' OR '1'='1",
      ]) {
        const response = await json('GET', `/api/v1/seller/stores/${encodeURIComponent(id)}`, {
          cookie: a.cookie,
        });
        expect(response.statusCode, id).toBe(404);
      }
    });

    it('drops seller access to a blocked store', async () => {
      const seller = await register();
      const store = await createStoreFor(seller.userId);
      await h.database.db.update(stores).set({ status: 'BLOCKED' }).where(eq(stores.id, store.id));
      expect(
        (await json('GET', `/api/v1/seller/stores/${store.id}`, { cookie: seller.cookie }))
          .statusCode,
      ).toBe(404);
    });

    it('gives store managers fewer permissions than owners', async () => {
      const manager = await register();
      const store = await createStoreFor(manager.userId, 'SELLER_MANAGER');
      const me = (await json('GET', '/api/v1/auth/me', { cookie: manager.cookie })).json();
      const access = me.stores.find((s: { storeId: string }) => s.storeId === store.id);
      expect(access.permissions).toContain('order:transition');
      expect(access.permissions).not.toContain('integration:manage');
      expect(access.permissions).not.toContain('store:team_manage');
    });
  });

  describe('cross-site requests', () => {
    it('rejects a state-changing request from another origin', async () => {
      const { phone } = await register();
      const forged = await json('POST', '/api/v1/auth/login', {
        body: { phone, password: PASSWORD },
        headers: { origin: 'https://evil.example' },
      });
      expect(forged.statusCode).toBe(403);

      const crossSite = await json('POST', '/api/v1/auth/login', {
        body: { phone, password: PASSWORD },
        headers: { 'sec-fetch-site': 'cross-site' },
      });
      expect(crossSite.statusCode).toBe(403);

      const sameSite = await json('POST', '/api/v1/auth/login', {
        body: { phone, password: PASSWORD },
        headers: { origin: ALLOWED_ORIGIN, 'sec-fetch-site': 'same-site' },
      });
      expect(sameSite.statusCode).toBe(200);
    });
  });

  describe('public catalog', () => {
    it('serves the category tree to anyone, in both languages', async () => {
      const response = await json('GET', '/api/v1/categories');
      expect(response.statusCode).toBe(200);
      const tree = response.json();
      expect(tree.map((c: { slug: string }) => c.slug)).toEqual([
        'clothing',
        'shoes',
        'accessories',
      ]);
      const shoes = tree.find((c: { slug: string }) => c.slug === 'shoes');
      expect(shoes.sizeChart).toBe('SHOES_EU');
      expect(shoes.children[0]).toMatchObject({
        slug: 'sneakers',
        name: { ru: 'Кроссовки', kk: 'Кроссовкалар' },
      });
    });
  });

  describe('guest customers', () => {
    it('creates a guest on first change and keeps data per browser', async () => {
      const empty = await json('GET', '/api/v1/customer/me');
      expect(empty.json()).toEqual({ name: null, phone: null, locale: 'ru' });
      expect(empty.cookies).toHaveLength(0);

      const created = await json('PATCH', '/api/v1/customer/me', {
        body: { name: 'Айгерим', phone: '8 701 123 45 67', locale: 'kk' },
      });
      expect(created.json()).toEqual({ name: 'Айгерим', phone: '+77011234567', locale: 'kk' });
      const guestCookie = created.cookies.find((c) => c.name === 'gsid');
      expect(guestCookie).toMatchObject({ httpOnly: true, sameSite: 'Lax' });

      const again = await json('GET', '/api/v1/customer/me', { cookie: cookieHeader(created) });
      expect(again.json().name).toBe('Айгерим');
      expect((await json('GET', '/api/v1/customer/me')).json().name).toBeNull();
    });
  });
});
