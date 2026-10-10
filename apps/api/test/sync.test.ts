import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import {
  and,
  eq,
  externalListings,
  inventory,
  products,
  productVariants,
  reserveStock,
  stores,
  syncRuns,
} from '@lastsize/db';
import type { Queue } from 'bullmq';
import { pino } from 'pino';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_ENV } from '../src/config/api-env';
import { APP_LOGGER } from '../src/logging';
import { StockSyncService, SyncBusyError } from '../src/sync/stock-sync.service';
import { SYNC_QUEUE_TOKEN, SyncScheduler } from '../src/sync/sync-queue';
import { SyncWorker } from '../src/sync/sync.worker';
import { createClient } from './client';
import { startFakes, TOKEN } from './fakes';
import { type Harness, startHarness, storageEnabled } from './harness';

const SIZE_EU = (size: number) => 2000 + (size - 19);
const tenge = (value: number) => value * 100;

describe.runIf(storageEnabled)('stock sync', () => {
  let h: Harness;
  let c: ReturnType<typeof createClient>;
  let fakes: Awaited<ReturnType<typeof startFakes>>;
  let sync: StockSyncService;
  let photo: Buffer;
  const logLines: string[] = [];

  beforeAll(async () => {
    photo = await sharp({
      create: { width: 900, height: 1200, channels: 3, background: { r: 90, g: 90, b: 90 } },
    })
      .jpeg()
      .toBuffer();
    fakes = await startFakes(photo);
    h = await startHarness({
      logger: pino(
        { level: 'debug' },
        new Writable({
          write: (chunk: Buffer, _encoding, callback) => {
            logLines.push(chunk.toString());
            callback();
          },
        }),
      ),
      env: {
        WB_CONTENT_API_URL: fakes.base,
        WB_PRICES_API_URL: fakes.base,
        WB_MARKETPLACE_API_URL: fakes.base,
        IMPORT_ALLOW_PRIVATE_HOSTS: 'true',
      },
    });
    c = createClient(h);
    sync = h.app.get(StockSyncService);
  });
  afterAll(async () => {
    await h?.close();
    fakes?.close();
  });

  async function seller() {
    const account = await c.register();
    const store = await c.createStoreFor(account.userId);
    await h.database.db
      .update(stores)
      .set({ status: 'VERIFIED', verifiedAt: new Date(Date.now() - 365 * 86_400_000) })
      .where(eq(stores.id, store.id));
    return { ...account, storeId: store.id, base: `/api/v1/seller/stores/${store.id}` };
  }

  async function uploadPhoto(cookie: string, storeId: string): Promise<string> {
    const boundary = `----ls${randomBytes(6).toString('hex')}`;
    const response = await h.app.inject({
      method: 'POST',
      url: `/api/v1/seller/stores/${storeId}/media`,
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
        ),
        photo,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    expect(response.statusCode).toBe(201);
    return response.json().id;
  }

  async function publishAll(cookie: string, base: string, jobId: string) {
    for (let i = 0; i < 20; i++) {
      const response = await c.json('POST', `${base}/imports/${jobId}/publish`, {
        cookie,
        body: { mode: 'publish' },
      });
      expect(response.statusCode).toBe(200);
      if (response.json().remaining === 0) break;
    }
  }

  /** A store with the WB sneakers (nmID 1001) imported: our 38 = WB 38 + 38.5, our 39 = WB 39. */
  async function wbStore() {
    Object.assign(fakes.state.amounts, { 501: 3, 502: 0, 503: 2 });
    fakes.state.prices[1001] = { price: 50000, discounted: 40000 };
    fakes.state.readOnly = false;
    const s = await seller();
    await c.json('POST', `${s.base}/integrations/wildberries`, {
      cookie: s.cookie,
      body: { token: TOKEN },
    });
    const job = (
      await c.json('POST', `${s.base}/imports`, {
        cookie: s.cookie,
        body: { source: 'WILDBERRIES' },
      })
    ).json();
    await c.json('POST', `${s.base}/imports/${job.id}/mappings`, {
      cookie: s.cookie,
      body: { kind: 'SIZE', chart: 'SHOES_EU', sourceValue: '38.5', targetId: SIZE_EU(38) },
    });
    await c.json('POST', `${s.base}/imports/${job.id}/prices`, {
      cookie: s.cookie,
      body: { percent: 40 },
    });
    await c.json('POST', `${s.base}/imports/${job.id}/selection`, {
      cookie: s.cookie,
      body: { selected: false },
    });
    const rows = (
      await c.json('GET', `${s.base}/imports/${job.id}/rows?limit=100`, { cookie: s.cookie })
    ).json().items as { id: string; externalId: string }[];
    const sneakers = rows.find((row) => row.externalId === '1001')!;
    await c.json('PATCH', `${s.base}/imports/${job.id}/rows/${sneakers.id}`, {
      cookie: s.cookie,
      body: { selected: true },
    });
    await publishAll(s.cookie, s.base, job.id);
    const [variant38] = await h.database.db
      .select({
        id: productVariants.id,
        productId: productVariants.productId,
        locationId: inventory.locationId,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .innerJoin(inventory, eq(inventory.variantId, productVariants.id))
      .where(and(eq(products.storeId, s.storeId), eq(productVariants.sizeValueId, SIZE_EU(38))));
    const [integration] = (
      await c.json('GET', `${s.base}/integrations`, { cookie: s.cookie })
    ).json() as { provider: string; linkedCount: number }[];
    expect(integration).toMatchObject({ provider: 'WILDBERRIES', linkedCount: 2 });
    const [listing] = await h.database.db
      .select()
      .from(externalListings)
      .where(eq(externalListings.variantId, variant38!.id));
    // The link remembers WB size 38 alone (3), not the merged 38 + 38.5 (5).
    expect(listing).toMatchObject({ externalSizeId: '501', lastExternalStock: 3 });
    return { ...s, variant38: variant38!, integrationId: listing!.integrationId };
  }

  async function stock(variantId: string) {
    const [row] = await h.database.db
      .select({ quantity: inventory.quantity, reserved: inventory.reserved })
      .from(inventory)
      .where(eq(inventory.variantId, variantId));
    return row!;
  }

  it('applies sales on WB to our stock, never taking units our buyers reserved', async () => {
    const s = await wbStore();
    expect(await stock(s.variant38.id)).toEqual({ quantity: 5, reserved: 0 });

    // Two pairs of 38 sold on WB.
    fakes.state.amounts[501] = 1;
    const first = await sync.run(s.integrationId, 'MANUAL');
    expect(first).toMatchObject({ status: 'SUCCESS', pulled: 1, pushed: 0, conflicts: 0 });
    expect(await stock(s.variant38.id)).toEqual({ quantity: 3, reserved: 0 });

    // Nothing changed on WB: nothing changes here.
    expect(await sync.run(s.integrationId, 'SCHEDULE')).toMatchObject({ pulled: 0 });

    // A buyer here reserved all 3; WB sells one more: it cannot come out of the reserved units.
    await reserveStock(
      h.database.db,
      [{ variantId: s.variant38.id, locationId: s.variant38.locationId, quantity: 3 }],
      { refType: 'test_order', refId: randomUUID() },
    );
    fakes.state.amounts[501] = 0;
    const conflict = await sync.run(s.integrationId, 'SCHEDULE');
    expect(conflict).toMatchObject({ status: 'PARTIAL', conflicts: 1 });
    expect(await stock(s.variant38.id)).toEqual({ quantity: 3, reserved: 3 });

    const runs = await c.json('GET', `${s.base}/integrations/WILDBERRIES/runs`, {
      cookie: s.cookie,
    });
    expect(runs.statusCode).toBe(200);
    const [latest, , oldest] = runs.json();
    expect(latest).toMatchObject({ status: 'PARTIAL', conflicts: 1, trigger: 'SCHEDULE' });
    expect(latest.changes).toEqual([
      { kind: 'conflict', title: 'Кроссовки Air Force 1', size: '38', from: 2, to: 3 },
    ]);
    expect(oldest.changes).toEqual([
      { kind: 'pull', title: 'Кроссовки Air Force 1', size: '38', from: 5, to: 3 },
    ]);
    expect(JSON.stringify(runs.json())).not.toContain(s.variant38.id);
  });

  it('writes our stock back to the chosen WB warehouse', async () => {
    const s = await wbStore();
    const noWarehouse = await c.json('PATCH', `${s.base}/integrations/WILDBERRIES`, {
      cookie: s.cookie,
      body: { pushStock: true },
    });
    expect(noWarehouse.json().errors).toEqual([
      { path: 'warehouseId', message: 'wb.warehouseRequired' },
    ]);
    const warehouses = await c.json('GET', `${s.base}/integrations/WILDBERRIES/warehouses`, {
      cookie: s.cookie,
    });
    expect(warehouses.json()).toEqual([{ id: 7, name: 'Склад Алматы' }]);
    const enabled = await c.json('PATCH', `${s.base}/integrations/WILDBERRIES`, {
      cookie: s.cookie,
      body: { warehouseId: 7, pushStock: true },
    });
    expect(enabled.json()[0]).toMatchObject({ pushStock: true, warehouseId: 7, syncEnabled: true });
    // A new warehouse means a new baseline: no jump is applied on the next run.
    const [listing] = await h.database.db
      .select()
      .from(externalListings)
      .where(eq(externalListings.variantId, s.variant38.id));
    expect(listing!.lastExternalStock).toBeNull();

    // Our 38 has 5 (WB 38 + 38.5 merged), WB 38 shows 3: WB is set to 5.
    fakes.state.pushes.length = 0;
    const pushed = await sync.run(s.integrationId, 'MANUAL');
    expect(pushed).toMatchObject({ status: 'SUCCESS', pulled: 0, pushed: 1 });
    expect(fakes.state.pushes).toEqual([[{ chrtId: 501, amount: 5 }]]);

    // A reservation here lowers WB too.
    await reserveStock(
      h.database.db,
      [{ variantId: s.variant38.id, locationId: s.variant38.locationId, quantity: 2 }],
      { refType: 'test_order', refId: randomUUID() },
    );
    await sync.run(s.integrationId, 'STOCK_CHANGE');
    expect(fakes.state.amounts[501]).toBe(3);

    // The seller edits stock: a sync is queued (delayed, deduplicated per integration).
    const queue = h.app.get<Queue>(SYNC_QUEUE_TOKEN);
    await queue.obliterate({ force: true });
    const product = await c.json('GET', `${s.base}/products/${s.variant38.productId}`, {
      cookie: s.cookie,
    });
    const edited = await c.json('PATCH', `${s.base}/products/${s.variant38.productId}`, {
      cookie: s.cookie,
      body: {
        variants: product.json().variants.map((v: { sizeValueId: number; quantity: number }) => ({
          sizeValueId: v.sizeValueId,
          quantity: v.sizeValueId === SIZE_EU(38) ? 8 : v.quantity,
        })),
      },
    });
    expect(edited.statusCode).toBe(200);
    const delayed = await queue.getDelayed();
    expect(delayed.map((job) => job.data)).toContainEqual({
      integrationId: s.integrationId,
      trigger: 'STOCK_CHANGE',
    });
    await sync.run(s.integrationId, 'STOCK_CHANGE');
    expect(fakes.state.amounts[501]).toBe(6);

    // A read-only token cannot write: the run says so instead of failing silently.
    fakes.state.readOnly = true;
    fakes.state.amounts[501] = 5; // one sold on WB, and one more reserved here
    await reserveStock(
      h.database.db,
      [{ variantId: s.variant38.id, locationId: s.variant38.locationId, quantity: 1 }],
      { refType: 'test_order', refId: randomUUID() },
    );
    const forbidden = await sync.run(s.integrationId, 'SCHEDULE');
    expect(forbidden).toMatchObject({ status: 'PARTIAL', pulled: 1, error: 'wb.pushForbidden' });
    expect(await stock(s.variant38.id)).toEqual({ quantity: 7, reserved: 3 });
    expect(fakes.state.amounts[501]).toBe(5);
    fakes.state.readOnly = false;
    expect(logLines.join('\n')).not.toContain(TOKEN);
  });

  it('flags a product when the WB price drops below its sale price', async () => {
    const s = await wbStore();
    fakes.state.prices[1001] = { price: 50000, discounted: 20000 };
    const outcome = await sync.run(s.integrationId, 'SCHEDULE');
    expect(outcome?.status).toBe('SUCCESS');
    const [variant] = await h.database.db
      .select({ externalPrice: productVariants.externalPrice })
      .from(productVariants)
      .where(eq(productVariants.id, s.variant38.id));
    expect(variant!.externalPrice).toBe(tenge(20000));
    const [product] = await h.database.db
      .select({ status: products.status, flagReason: products.flagReason })
      .from(products)
      .where(eq(products.id, s.variant38.productId));
    expect(product).toEqual({ status: 'FLAGGED', flagReason: 'discount.externalPriceDropped' });
  });

  it('follows a Kaspi price list', async () => {
    fakes.state.kaspiStock = { 'K-40': 1, 'K-41': 2 };
    const s = await seller();
    const job = (
      await c.json('POST', `${s.base}/imports`, {
        cookie: s.cookie,
        body: { source: 'KASPI_XML', url: `${fakes.base}/kaspi.xml` },
      })
    ).json();
    await c.json('POST', `${s.base}/imports/${job.id}/fill`, {
      cookie: s.cookie,
      body: { gender: 'MEN' },
    });
    await c.json('POST', `${s.base}/imports/${job.id}/prices`, {
      cookie: s.cookie,
      body: { percent: 30 },
    });
    const [row] = (
      await c.json('GET', `${s.base}/imports/${job.id}/rows`, { cookie: s.cookie })
    ).json().items;
    const mediaId = await uploadPhoto(s.cookie, s.storeId);
    const ready = await c.json('PATCH', `${s.base}/imports/${job.id}/rows/${row.id}`, {
      cookie: s.cookie,
      body: { mediaIds: [mediaId] },
    });
    expect(ready.json().status).toBe('READY');
    await publishAll(s.cookie, s.base, job.id);

    const [integration] = (
      await c.json('GET', `${s.base}/integrations`, { cookie: s.cookie })
    ).json();
    expect(integration).toMatchObject({ provider: 'KASPI_XML', linkedCount: 2 });
    const [link] = await h.database.db
      .select({ id: externalListings.integrationId })
      .from(externalListings)
      .innerJoin(productVariants, eq(productVariants.id, externalListings.variantId))
      .where(eq(productVariants.storeId, s.storeId));
    const integrationId = link!.id;

    fakes.state.kaspiStock['K-41'] = 0; // both pairs of 41 sold on Kaspi
    expect(await sync.run(integrationId, 'MANUAL')).toMatchObject({ status: 'SUCCESS', pulled: 1 });
    const [variant41] = await h.database.db
      .select({ quantity: inventory.quantity })
      .from(inventory)
      .innerJoin(productVariants, eq(productVariants.id, inventory.variantId))
      .where(
        and(eq(productVariants.storeId, s.storeId), eq(productVariants.sizeValueId, SIZE_EU(41))),
      );
    expect(variant41!.quantity).toBe(0);

    // Kaspi cannot be written to: the switch is WB only.
    const push = await c.json('PATCH', `${s.base}/integrations/KASPI_XML`, {
      cookie: s.cookie,
      body: { pushStock: true },
    });
    expect(push.json().errors).toEqual([{ path: 'pushStock', message: 'sync.wbOnly' }]);

    // Turned off: scheduled runs skip it.
    await c.json('PATCH', `${s.base}/integrations/KASPI_XML`, {
      cookie: s.cookie,
      body: { syncEnabled: false },
    });
    expect(await sync.run(integrationId, 'SCHEDULE')).toBeNull();
    expect(await sync.dueIntegrations()).not.toContain(integrationId);
  });

  it('runs one sync per integration at a time and schedules all of them', async () => {
    const s = await wbStore();
    const [a, b] = await Promise.allSettled([
      sync.run(s.integrationId, 'MANUAL'),
      sync.run(s.integrationId, 'MANUAL'),
    ]);
    const outcomes = [a, b].map((r) => r.status);
    expect(outcomes.sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = [a, b].find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(SyncBusyError);

    const worker = new SyncWorker(
      h.app.get(API_ENV),
      h.app.get(APP_LOGGER),
      h.app.get(SYNC_QUEUE_TOKEN),
      sync,
      h.app.get(SyncScheduler),
    );
    const result = await worker.process({ name: 'sweep', data: {} } as never);
    expect((result as { queued: number }).queued).toBeGreaterThanOrEqual(1);
    const waiting = await h.app.get<Queue>(SYNC_QUEUE_TOKEN).getWaiting();
    expect(waiting.map((job) => job.data)).toContainEqual({
      integrationId: s.integrationId,
      trigger: 'SCHEDULE',
    });

    // The owner can ask for a sync; others cannot see the log.
    const now = await c.json('POST', `${s.base}/integrations/WILDBERRIES/sync`, {
      cookie: s.cookie,
    });
    expect(now.statusCode).toBe(202);
    const stranger = await c.register();
    const hidden = await c.json('GET', `${s.base}/integrations/WILDBERRIES/runs`, {
      cookie: stranger.cookie,
    });
    expect(hidden.statusCode).toBe(404);
    const runs = await h.database.db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.integrationId, s.integrationId));
    expect(runs.every((run) => run.status !== 'RUNNING')).toBe(true);
  });
});
