import { auditLogs, eq, stores, storeMembers, users } from '@lastsize/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from './client';
import { type Harness, integrationEnabled, startHarness } from './harness';

const VALID_BIN = '971240001315';
const SCHEDULE = {
  mon: [['10:00', '20:00']],
  tue: [['10:00', '20:00']],
  wed: [['10:00', '20:00']],
  thu: [['10:00', '20:00']],
  fri: [['10:00', '20:00']],
  sat: [['11:00', '18:00']],
  sun: [],
};

const storeBody = (overrides: Record<string, unknown> = {}) => ({
  name: 'Nora Showroom',
  binIin: VALID_BIN,
  description: 'Шоурум женской одежды',
  instagram: '@nora.showroom',
  location: {
    cityId: 1,
    address: 'Алматы, пр. Абая 52, 2 этаж',
    phone: '8 701 123 45 67',
    schedule: SCHEDULE,
    pickupEnabled: true,
  },
  ...overrides,
});

describe.runIf(integrationEnabled)('stores', () => {
  let h: Harness;
  let c: ReturnType<typeof createClient>;
  beforeAll(async () => {
    h = await startHarness();
    c = createClient(h);
  });
  afterAll(async () => {
    await h?.close();
  });

  async function sellerWithStore(overrides: Record<string, unknown> = {}) {
    const seller = await c.register();
    const response = await c.json('POST', '/api/v1/seller/stores', {
      cookie: seller.cookie,
      body: storeBody(overrides),
    });
    expect(response.statusCode).toBe(201);
    return { ...seller, store: response.json() as { id: string; slug: string; status: string } };
  }

  describe('seller', () => {
    it('creates a store under review with the seller as owner', async () => {
      const { store, cookie, userId } = await sellerWithStore();
      expect(store).toMatchObject({
        status: 'PENDING_VERIFICATION',
        role: 'SELLER',
        instagram: 'nora.showroom',
        location: { phone: '+77011234567', cityName: { ru: 'Алматы' } },
      });
      expect(store.slug).toMatch(/^nora-showroom(-\d+)?$/);

      const me = (await c.json('GET', '/api/v1/auth/me', { cookie })).json();
      expect(me.stores[0]).toMatchObject({ storeId: store.id, role: 'SELLER' });
      expect(me.stores[0].permissions).toContain('store:manage');

      const audit = await h.database.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, store.id));
      expect(audit.map((entry) => entry.action)).toContain('store.created');
      expect(audit[0]!.actorId).toBe(userId);
    });

    it('gives each store a unique address', async () => {
      const first = await sellerWithStore({ name: 'Қызыл Әлем' });
      const second = await sellerWithStore({ name: 'Қызыл Әлем' });
      expect(first.store.slug).toMatch(/^kyzyl-alem/);
      expect(second.store.slug).not.toBe(first.store.slug);
    });

    it('rejects an invalid BIN/IIN, schedule and city with codes the UI can translate', async () => {
      const seller = await c.register();
      const response = await c.json('POST', '/api/v1/seller/stores', {
        cookie: seller.cookie,
        body: storeBody({
          binIin: '971240001316',
          location: {
            ...storeBody().location,
            schedule: { ...SCHEDULE, mon: [['20:00', '10:00']] },
          },
        }),
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().errors).toEqual(
        expect.arrayContaining([
          { path: 'binIin', message: 'binIin.invalid' },
          { path: 'location.schedule.mon.0', message: 'schedule.order' },
        ]),
      );

      const unknownCity = await c.json('POST', '/api/v1/seller/stores', {
        cookie: seller.cookie,
        body: storeBody({ location: { ...storeBody().location, cityId: 999 } }),
      });
      expect(unknownCity.statusCode).toBe(404);
    });

    it('does not let a seller set the status or other server-side fields', async () => {
      const seller = await c.register();
      const response = await c.json('POST', '/api/v1/seller/stores', {
        cookie: seller.cookie,
        body: { ...storeBody(), status: 'VERIFIED', commissionRate: '0' },
      });
      expect(response.statusCode).toBe(422);
    });

    it('allows one owned store per seller, even with simultaneous requests', async () => {
      const seller = await c.register();
      const responses = await Promise.all(
        [1, 2, 3].map(() =>
          c.json('POST', '/api/v1/seller/stores', { cookie: seller.cookie, body: storeBody() }),
        ),
      );
      expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
    });

    it('requires a signed-in seller', async () => {
      expect(
        (await c.json('POST', '/api/v1/seller/stores', { body: storeBody() })).statusCode,
      ).toBe(401);
    });

    it('hides a store from other sellers and lets only the owner edit it', async () => {
      const owner = await sellerWithStore();
      const stranger = await c.register();
      expect(
        (
          await c.json('GET', `/api/v1/seller/stores/${owner.store.id}`, {
            cookie: stranger.cookie,
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await c.json('PATCH', `/api/v1/seller/stores/${owner.store.id}`, {
            cookie: stranger.cookie,
            body: { name: 'Чужое' },
          })
        ).statusCode,
      ).toBe(404);

      const manager = await c.register();
      await h.database.db
        .insert(storeMembers)
        .values({ storeId: owner.store.id, userId: manager.userId, role: 'SELLER_MANAGER' });
      const managerLogin = await c.login(manager.phone);
      const managerCookie = managerLogin.cookies.map((x) => `${x.name}=${x.value}`).join('; ');
      expect(
        (await c.json('GET', `/api/v1/seller/stores/${owner.store.id}`, { cookie: managerCookie }))
          .statusCode,
      ).toBe(200);
      expect(
        (
          await c.json('PATCH', `/api/v1/seller/stores/${owner.store.id}`, {
            cookie: managerCookie,
            body: { name: 'Менеджер' },
          })
        ).statusCode,
      ).toBe(403);
    });
  });

  describe('admin verification', () => {
    it('is closed to sellers and to staff without the authenticator code', async () => {
      const { store, cookie } = await sellerWithStore();
      expect((await c.json('GET', '/api/v1/admin/stores', { cookie })).statusCode).toBe(403);
      expect(
        (
          await c.json('POST', `/api/v1/admin/stores/${store.id}/verify`, {
            cookie,
            body: { phoneConfirmed: true },
          })
        ).statusCode,
      ).toBe(403);
      const staff = await c.makeStaff();
      expect(
        (await c.json('GET', '/api/v1/admin/stores', { cookie: staff.cookie })).statusCode,
      ).toBe(403);
    });

    it('lists the review queue with owner contacts and counts per status', async () => {
      const { store, phone } = await sellerWithStore();
      const admin = await c.makeVerifiedStaff();
      const queue = (
        await c.json('GET', '/api/v1/admin/stores?status=PENDING_VERIFICATION', {
          cookie: admin.cookie,
        })
      ).json();
      const item = queue.items.find((s: { id: string }) => s.id === store.id);
      expect(item).toMatchObject({
        ownerPhone: phone,
        city: 'Алматы',
        status: 'PENDING_VERIFICATION',
      });
      expect(queue.counts.PENDING_VERIFICATION).toBeGreaterThanOrEqual(1);
    });

    it('verifies only after the admin confirms the phone call, and marks the owner phone as verified', async () => {
      const { store, userId, cookie } = await sellerWithStore();
      const admin = await c.makeVerifiedStaff();
      const withoutCall = await c.json('POST', `/api/v1/admin/stores/${store.id}/verify`, {
        cookie: admin.cookie,
        body: {},
      });
      expect(withoutCall.statusCode).toBe(422);

      const verified = await c.json('POST', `/api/v1/admin/stores/${store.id}/verify`, {
        cookie: admin.cookie,
        body: { phoneConfirmed: true },
      });
      expect(verified.statusCode).toBe(204);

      const [owner] = await h.database.db.select().from(users).where(eq(users.id, userId));
      expect(owner!.phoneVerifiedAt).not.toBeNull();
      const detail = (await c.json('GET', `/api/v1/seller/stores/${store.id}`, { cookie })).json();
      expect(detail.status).toBe('VERIFIED');

      const again = await c.json('POST', `/api/v1/admin/stores/${store.id}/verify`, {
        cookie: admin.cookie,
        body: { phoneConfirmed: true },
      });
      expect(again.statusCode).toBe(409);
    });

    it('rejects with a reason the seller sees; fixing the store sends it back to review', async () => {
      const { store, cookie } = await sellerWithStore();
      const admin = await c.makeVerifiedStaff();
      const noReason = await c.json('POST', `/api/v1/admin/stores/${store.id}/reject`, {
        cookie: admin.cookie,
        body: { reason: '' },
      });
      expect(noReason.statusCode).toBe(422);

      const reason = 'БИН принадлежит другой компании';
      expect(
        (
          await c.json('POST', `/api/v1/admin/stores/${store.id}/reject`, {
            cookie: admin.cookie,
            body: { reason },
          })
        ).statusCode,
      ).toBe(204);
      const rejected = (
        await c.json('GET', `/api/v1/seller/stores/${store.id}`, { cookie })
      ).json();
      expect(rejected).toMatchObject({ status: 'REJECTED', statusReason: reason });

      const fixed = await c.json('PATCH', `/api/v1/seller/stores/${store.id}`, {
        cookie,
        body: { binIin: '990340005977' },
      });
      expect(fixed.json()).toMatchObject({
        status: 'PENDING_VERIFICATION',
        statusReason: null,
        binIin: '990340005977',
      });

      const history = (
        await c.json('GET', `/api/v1/admin/stores/${store.id}`, { cookie: admin.cookie })
      ).json().history;
      expect(history.map((entry: { action: string }) => entry.action)).toEqual([
        'store.resubmitted',
        'store.rejected',
        'store.created',
      ]);
      expect(history[1]).toMatchObject({ reason, actorName: 'Асель' });
    });

    it('sends a verified store back to review when its legal data changes', async () => {
      const { store, cookie } = await sellerWithStore();
      const admin = await c.makeVerifiedStaff();
      await c.json('POST', `/api/v1/admin/stores/${store.id}/verify`, {
        cookie: admin.cookie,
        body: { phoneConfirmed: true },
      });

      const renamed = await c.json('PATCH', `/api/v1/seller/stores/${store.id}`, {
        cookie,
        body: { name: 'Nora Outlet' },
      });
      expect(renamed.json().status).toBe('VERIFIED');
      const newBin = await c.json('PATCH', `/api/v1/seller/stores/${store.id}`, {
        cookie,
        body: { binIin: '940140000385' },
      });
      expect(newBin.json().status).toBe('PENDING_VERIFICATION');
    });

    it('blocks a store: the seller loses access at once; unblocking restores the previous standing', async () => {
      const { store, cookie } = await sellerWithStore();
      const admin = await c.makeVerifiedStaff();
      await c.json('POST', `/api/v1/admin/stores/${store.id}/verify`, {
        cookie: admin.cookie,
        body: { phoneConfirmed: true },
      });

      const reason = 'Жалобы покупателей на подделки';
      expect(
        (
          await c.json('POST', `/api/v1/admin/stores/${store.id}/block`, {
            cookie: admin.cookie,
            body: { reason },
          })
        ).statusCode,
      ).toBe(204);
      expect(
        (await c.json('GET', `/api/v1/seller/stores/${store.id}`, { cookie })).statusCode,
      ).toBe(404);
      const list = (await c.json('GET', '/api/v1/seller/stores', { cookie })).json();
      expect(list[0]).toMatchObject({ id: store.id, status: 'BLOCKED', statusReason: reason });

      expect(
        (
          await c.json('POST', `/api/v1/admin/stores/${store.id}/block`, {
            cookie: admin.cookie,
            body: { reason },
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (await c.json('POST', `/api/v1/admin/stores/${store.id}/unblock`, { cookie: admin.cookie }))
          .statusCode,
      ).toBe(204);
      const [row] = await h.database.db.select().from(stores).where(eq(stores.id, store.id));
      expect(row).toMatchObject({ status: 'VERIFIED', rejectionReason: null });
    });

    it('lets only one of two simultaneous admin decisions win', async () => {
      const { store } = await sellerWithStore();
      const admin = await c.makeVerifiedStaff();
      const [verify, reject] = await Promise.all([
        c.json('POST', `/api/v1/admin/stores/${store.id}/verify`, {
          cookie: admin.cookie,
          body: { phoneConfirmed: true },
        }),
        c.json('POST', `/api/v1/admin/stores/${store.id}/reject`, {
          cookie: admin.cookie,
          body: { reason: 'Не дозвонились до владельца' },
        }),
      ]);
      expect([verify.statusCode, reject.statusCode].sort()).toEqual([204, 409]);
    });

    it('answers 404 for unknown or malformed store ids', async () => {
      const admin = await c.makeVerifiedStaff();
      for (const id of ['01a10cbc-0000-7000-8000-000000000000', 'not-a-uuid']) {
        expect(
          (await c.json('GET', `/api/v1/admin/stores/${id}`, { cookie: admin.cookie })).statusCode,
          id,
        ).toBe(404);
      }
    });
  });

  it('keeps at least one way to receive orders', async () => {
    const { store, cookie } = await sellerWithStore();
    expect(store).toMatchObject({ location: { pickupEnabled: true, deliveryEnabled: true } });
    const pickupOnly = await c.json('PATCH', `/api/v1/seller/stores/${store.id}`, {
      cookie,
      body: { location: { deliveryEnabled: false } },
    });
    expect(pickupOnly.json().location).toMatchObject({
      pickupEnabled: true,
      deliveryEnabled: false,
    });
    // Changing only the address keeps the switches as they are.
    const moved = await c.json('PATCH', `/api/v1/seller/stores/${store.id}`, {
      cookie,
      body: { location: { address: 'Абая 100, офис 2' } },
    });
    expect(moved.json().location).toMatchObject({ pickupEnabled: true, deliveryEnabled: false });
    const nothing = await c.json('PATCH', `/api/v1/seller/stores/${store.id}`, {
      cookie,
      body: { location: { pickupEnabled: false } },
    });
    expect(nothing.json().errors).toEqual([
      { path: 'location.deliveryEnabled', message: 'fulfillment.none' },
    ]);
  });

  it('serves the list of cities publicly', async () => {
    const response = await c.json('GET', '/api/v1/cities');
    expect(response.json()[0]).toEqual({
      id: 1,
      slug: 'almaty',
      name: { ru: 'Алматы', kk: 'Алматы' },
    });
  });
});
