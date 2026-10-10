import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import {
  auditLogs,
  eq,
  externalListings,
  integrationCredentials,
  products,
  productVariants,
  stores,
} from '@lastsize/db';
import { pino } from 'pino';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from './client';
import { type Harness, startHarness, storageEnabled } from './harness';

const TOKEN = `wb-${randomBytes(24).toString('base64url')}`;
const SIZE_EU = (size: number) => 2000 + (size - 19);
const SIZE_M = 1003;
const SIZE_L = 1004;
const HOODIES = 105;
const tenge = (value: number) => value * 100;

function body(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    request.on('data', (chunk: Buffer) => (data += chunk.toString()));
    request.on('end', () => resolve(data));
  });
}

/** A local stand-in for the Wildberries APIs, a Kaspi price list and a photo CDN. */
async function startFakes(photo: Buffer) {
  const requests: { url: string; authorization: string | undefined }[] = [];
  let base = '';
  const server: Server = createServer(async (request, response) => {
    const url = request.url ?? '';
    const authorization = request.headers.authorization;
    requests.push({ url, authorization });
    const json = (status: number, payload: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    };
    if (url.startsWith('/photos/')) {
      if (url === '/photos/1.jpg') {
        response.writeHead(200, { 'content-type': 'image/jpeg' });
        return response.end(photo);
      }
      if (url === '/photos/not-image.jpg') return response.end('<html>nope</html>');
      return response.writeHead(404).end();
    }
    if (url === '/kaspi.xml') {
      response.writeHead(200, { 'content-type': 'application/xml' });
      return response.end(`<?xml version="1.0" encoding="utf-8"?>
<kaspi_catalog xmlns="kaspiShopping"><offers>
  <offer sku="K-40"><model>Ботинки Timberland желтые 40</model><brand>Timberland</brand>
    <availabilities><availability available="yes" storeId="PP1" stockCount="1"/></availabilities><price>89990</price></offer>
  <offer sku="K-41"><model>Ботинки Timberland желтые 41</model><brand>Timberland</brand>
    <availabilities><availability available="yes" storeId="PP1" stockCount="2"/></availabilities><price>89990</price></offer>
</offers></kaspi_catalog>`);
    }
    if (authorization !== TOKEN) return json(401, { title: 'unauthorized' });

    if (url === '/content/v2/get/cards/list' && request.method === 'POST') {
      const settings = JSON.parse(await body(request)).settings;
      const cards = [
        {
          nmID: 1001,
          imtID: 1,
          vendorCode: 'AF1-W',
          brand: 'Nike',
          title: 'Кроссовки Air Force 1',
          description: 'Классика',
          subjectName: 'Кроссовки',
          photos: [
            { big: `${base}/photos/1.jpg` },
            { big: `${base}/photos/missing.jpg` },
            { big: `${base}/photos/not-image.jpg` },
          ],
          characteristics: [
            { id: 1, name: 'Цвет', value: ['белый'] },
            { id: 2, name: 'Пол', value: ['Женский'] },
          ],
          sizes: [
            { chrtID: 501, techSize: '38', wbSize: '38', skus: ['2000000000501'] },
            { chrtID: 502, techSize: '39', wbSize: '39', skus: ['2000000000502'] },
            { chrtID: 503, techSize: '38.5', wbSize: '38.5', skus: ['2000000000503'] },
          ],
        },
        {
          nmID: 1002,
          vendorCode: 'HD-2',
          brand: 'Adidas',
          title: 'Худи оверсайз',
          description: '',
          subjectName: 'Худи',
          photos: [],
          characteristics: [
            { id: 1, name: 'Цвет', value: ['черный'] },
            { id: 2, name: 'Пол', value: ['Мужской'] },
          ],
          sizes: [
            { chrtID: 601, techSize: 'M', wbSize: '46', skus: ['601'] },
            { chrtID: 602, techSize: 'L', wbSize: '48', skus: ['602'] },
          ],
        },
        {
          nmID: 1003,
          vendorCode: 'PL-3',
          brand: 'Home',
          title: 'Подушка декоративная',
          subjectName: 'Подушки',
          photos: [{ big: `${base}/photos/1.jpg` }],
          characteristics: [],
          sizes: [{ chrtID: 701, techSize: '0', wbSize: '', skus: ['701'] }],
        },
      ];
      return json(200, {
        cards: cards.slice(0, settings.cursor.limit),
        cursor: { updatedAt: '2026-10-01T00:00:00Z', nmID: 1003, total: cards.length },
      });
    }
    if (url.startsWith('/api/v2/list/goods/filter')) {
      return json(200, {
        data: {
          listGoods: [
            {
              nmID: 1001,
              currencyIsoCode4217: 'KZT',
              sizes: [{ sizeID: 501, price: 50000, discountedPrice: 40000 }],
            },
            {
              nmID: 1002,
              currencyIsoCode4217: 'KZT',
              sizes: [{ sizeID: 601, price: 30000, discountedPrice: 30000 }],
            },
          ],
        },
      });
    }
    if (url === '/api/v3/warehouses') return json(200, [{ id: 7, name: 'Склад Алматы' }]);
    if (url === '/api/v3/stocks/7') {
      const amounts: Record<number, number> = { 501: 3, 502: 0, 503: 2, 601: 4, 602: 1, 701: 5 };
      const { chrtIds } = JSON.parse(await body(request)) as { chrtIds: number[] };
      return json(200, {
        stocks: chrtIds.map((chrtId) => ({ chrtId, amount: amounts[chrtId] ?? 0 })),
      });
    }
    return json(404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    requests,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

describe.runIf(storageEnabled)('imports', () => {
  let h: Harness;
  let c: ReturnType<typeof createClient>;
  let fakes: Awaited<ReturnType<typeof startFakes>>;
  const logLines: string[] = [];

  beforeAll(async () => {
    const photo = await sharp({
      create: { width: 900, height: 1200, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .jpeg()
      .toBuffer();
    fakes = await startFakes(photo);
    const logger = pino(
      { level: 'debug' },
      new Writable({
        write: (chunk: Buffer, _encoding, callback) => {
          logLines.push(chunk.toString());
          callback();
        },
      }),
    );
    h = await startHarness({
      logger,
      env: {
        WB_CONTENT_API_URL: fakes.base,
        WB_PRICES_API_URL: fakes.base,
        WB_MARKETPLACE_API_URL: fakes.base,
        IMPORT_ALLOW_PRIVATE_HOSTS: 'true',
      },
    });
    c = createClient(h);
  });
  afterAll(async () => {
    await h?.close();
    fakes?.close();
  });

  async function seller(verified = true) {
    const account = await c.register();
    const store = await c.createStoreFor(account.userId);
    if (verified)
      await h.database.db
        .update(stores)
        .set({ status: 'VERIFIED', verifiedAt: new Date(Date.now() - 365 * 86_400_000) })
        .where(eq(stores.id, store.id));
    return { ...account, storeId: store.id, base: `/api/v1/seller/stores/${store.id}` };
  }

  async function rows(cookie: string, base: string, jobId: string) {
    const response = await c.json('GET', `${base}/imports/${jobId}/rows?limit=100`, { cookie });
    expect(response.statusCode).toBe(200);
    return response.json().items as {
      id: string;
      externalId: string;
      status: string;
      issues: string[];
      sizes: { label: string | null; quantity: number; sizeValueId: number | null }[];
      salePrice: number | null;
      originalPrice: number | null;
      discountPercent: number | null;
      productId: string | null;
      categoryId: number | null;
      gender: string | null;
      colorId: number | null;
    }[];
  }

  async function publishAll(cookie: string, base: string, jobId: string, mode = 'publish') {
    const processed: { rowId: string; status: string; issues: string[] }[] = [];
    for (let i = 0; i < 20; i++) {
      const response = await c.json('POST', `${base}/imports/${jobId}/publish`, {
        cookie,
        body: { mode },
      });
      expect(response.statusCode).toBe(200);
      processed.push(...response.json().processed);
      if (response.json().remaining === 0) break;
    }
    return processed;
  }

  it('lets only the store owner manage imports', async () => {
    const owner = await seller();
    const manager = await c.register();
    const managerStore = await c.createStoreFor(manager.userId, 'SELLER_MANAGER');
    const stranger = await c.register();

    const asManager = await c.json('GET', `/api/v1/seller/stores/${managerStore.id}/integrations`, {
      cookie: manager.cookie,
    });
    expect(asManager.statusCode).toBe(403);
    const asStranger = await c.json('GET', `${owner.base}/integrations`, {
      cookie: stranger.cookie,
    });
    expect(asStranger.statusCode).toBe(404);
    const anonymous = await c.json('POST', `${owner.base}/integrations/wildberries`, {
      body: { token: TOKEN },
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('stores the WB token encrypted and never shows it again', async () => {
    const s = await seller();
    const wrong = await c.json('POST', `${s.base}/integrations/wildberries`, {
      cookie: s.cookie,
      body: { token: `${TOKEN}x` },
    });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().errors).toEqual([{ path: 'token', message: 'wb.tokenInvalid' }]);

    const connected = await c.json('POST', `${s.base}/integrations/wildberries`, {
      cookie: s.cookie,
      body: { token: TOKEN },
    });
    expect(connected.statusCode).toBe(200);
    expect(connected.json()).toEqual([
      expect.objectContaining({
        provider: 'WILDBERRIES',
        status: 'ACTIVE',
        tokenHint: `••••${TOKEN.slice(-4)}`,
      }),
    ]);
    const listed = await c.json('GET', `${s.base}/integrations`, { cookie: s.cookie });
    expect(listed.body).not.toContain(TOKEN);
    expect(connected.body).not.toContain(TOKEN);

    const [credential] = await h.database.db.select().from(integrationCredentials);
    expect(credential!.ciphertext).not.toContain(TOKEN);
    const audit = await h.database.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'integration.connected'));
    expect(JSON.stringify(audit)).not.toContain(TOKEN);

    const removed = await c.json('DELETE', `${s.base}/integrations/WILDBERRIES`, {
      cookie: s.cookie,
    });
    expect(removed.statusCode).toBe(204);
    expect((await c.json('GET', `${s.base}/integrations`, { cookie: s.cookie })).json()).toEqual(
      [],
    );
    expect(await h.database.db.select().from(integrationCredentials)).toEqual([]);
  });

  it('imports from Wildberries through matching, pricing and publishing', async () => {
    const s = await seller();
    const noToken = await c.json('POST', `${s.base}/imports`, {
      cookie: s.cookie,
      body: { source: 'WILDBERRIES' },
    });
    expect(noToken.statusCode).toBe(409);
    await c.json('POST', `${s.base}/integrations/wildberries`, {
      cookie: s.cookie,
      body: { token: TOKEN },
    });

    const created = await c.json('POST', `${s.base}/imports`, {
      cookie: s.cookie,
      body: { source: 'WILDBERRIES' },
    });
    expect(created.statusCode).toBe(201);
    const job = created.json();
    expect(job.counts).toMatchObject({ total: 3, ready: 0, needsAttention: 3 });
    expect(job.unmapped.categories).toEqual([{ value: 'Подушки', count: 1 }]);
    expect(job.unmapped.sizes).toEqual([{ chart: 'SHOES_EU', value: '38.5', count: 1 }]);

    let [sneakers, hoodie, pillow] = await rows(s.cookie, s.base, job.id);
    expect(sneakers).toMatchObject({
      externalId: '1001',
      categoryId: 201,
      gender: 'WOMEN',
      colorId: 2,
      originalPrice: tenge(50000),
      salePrice: null,
    });
    expect(sneakers!.issues).toEqual(['sizes.unmapped', 'price.saleRequired']);
    expect(sneakers!.sizes).toEqual([
      { label: '38', quantity: 3, sizeValueId: SIZE_EU(38) },
      { label: '39', quantity: 0, sizeValueId: SIZE_EU(39) },
      { label: '38.5', quantity: 2, sizeValueId: null },
    ]);
    expect(hoodie).toMatchObject({ categoryId: HOODIES, gender: 'MEN', colorId: 1 });
    expect(hoodie!.issues).toEqual(['images.required', 'price.saleRequired']);
    expect(hoodie!.sizes.map((size) => size.sizeValueId)).toEqual([SIZE_M, SIZE_L]);
    expect(pillow!.categoryId).toBeNull();

    // Step 2: "38.5 on WB is our 38", remembered for the store.
    const mapped = await c.json('POST', `${s.base}/imports/${job.id}/mappings`, {
      cookie: s.cookie,
      body: { kind: 'SIZE', chart: 'SHOES_EU', sourceValue: '38.5', targetId: SIZE_EU(38) },
    });
    expect(mapped.statusCode).toBe(201);
    expect(mapped.json().unmapped.sizes).toEqual([]);
    const wrongChart = await c.json('POST', `${s.base}/imports/${job.id}/mappings`, {
      cookie: s.cookie,
      body: { kind: 'SIZE', chart: 'SHOES_EU', sourceValue: '37', targetId: SIZE_M },
    });
    expect(wrongChart.statusCode).toBe(422);

    // Step 3: 40% off the marketplace price, rounded to …90 ₸.
    const priced = await c.json('POST', `${s.base}/imports/${job.id}/prices`, {
      cookie: s.cookie,
      body: { percent: 40 },
    });
    expect(priced.statusCode).toBe(201);
    [sneakers, hoodie, pillow] = await rows(s.cookie, s.base, job.id);
    expect(sneakers).toMatchObject({
      status: 'READY',
      salePrice: tenge(23990),
      discountPercent: 40,
    });
    expect(hoodie!.salePrice).toBe(tenge(17990));

    // The hoodie has no photos on WB: the seller uploads one. The pillow is left out.
    const photo = await sharp({
      create: { width: 800, height: 800, channels: 3, background: { r: 10, g: 10, b: 10 } },
    })
      .jpeg()
      .toBuffer();
    const boundary = `----ls${randomBytes(6).toString('hex')}`;
    const uploaded = await h.app.inject({
      method: 'POST',
      url: `/api/v1/seller/stores/${s.storeId}/media`,
      headers: {
        cookie: s.cookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
        ),
        photo,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    expect(uploaded.statusCode).toBe(201);
    const withPhoto = await c.json('PATCH', `${s.base}/imports/${job.id}/rows/${hoodie!.id}`, {
      cookie: s.cookie,
      body: { mediaIds: [uploaded.json().id] },
    });
    expect(withPhoto.json()).toMatchObject({ status: 'READY', issues: [] });
    expect(withPhoto.json().images).toHaveLength(1);
    const skipped = await c.json('PATCH', `${s.base}/imports/${job.id}/rows/${pillow!.id}`, {
      cookie: s.cookie,
      body: { selected: false },
    });
    expect(skipped.json().selected).toBe(false);

    // Another store's photo cannot be attached.
    const other = await seller();
    const foreign = await c.json('PATCH', `${other.base}/imports/${job.id}/rows/${hoodie!.id}`, {
      cookie: other.cookie,
      body: { title: 'Чужое' },
    });
    expect(foreign.statusCode).toBe(404);

    // Step 4: publish in small batches.
    const processed = await publishAll(s.cookie, s.base, job.id);
    expect(processed.map((p) => p.status)).toEqual(['PUBLISHED', 'PUBLISHED']);
    [sneakers, hoodie, pillow] = await rows(s.cookie, s.base, job.id);
    expect(pillow!.status).toBe('NEEDS_ATTENTION');
    expect(hoodie!.status).toBe('PUBLISHED');

    const [product] = await h.database.db
      .select()
      .from(products)
      .where(eq(products.id, sneakers!.productId!));
    expect(product).toMatchObject({ status: 'ACTIVE', title: 'Кроссовки Air Force 1' });
    const variants = await h.database.db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, product!.id));
    expect(variants.map((v) => [v.sizeValueId, v.externalPrice, v.discountPercent]).sort()).toEqual(
      [
        [SIZE_EU(38), tenge(40000), 40],
        [SIZE_EU(39), tenge(40000), 40],
      ].sort(),
    );
    const detail = await c.json('GET', `${s.base}/products/${product!.id}`, { cookie: s.cookie });
    // Only the real photo survived: the 404 and the HTML "photo" were skipped.
    expect(detail.json().images).toHaveLength(1);
    expect(
      detail
        .json()
        .variants.map((v: { sizeLabel: string; quantity: number }) => [v.sizeLabel, v.quantity]),
    ).toEqual([
      ['38', 5],
      ['39', 0],
    ]);
    const listings = await h.database.db.select().from(externalListings);
    expect(listings.map((l) => [l.externalProductId, l.externalSizeId]).sort()).toEqual(
      [
        ['1001', '501'],
        ['1001', '502'],
        ['1002', '601'],
        ['1002', '602'],
      ].sort(),
    );

    // A second import does not bring the same goods twice.
    const again = await c.json('POST', `${s.base}/imports`, {
      cookie: s.cookie,
      body: { source: 'WILDBERRIES' },
    });
    expect(again.json().counts).toMatchObject({ skipped: 2, total: 3 });

    // WB was always called with the token, and the token never reached the logs.
    expect(fakes.requests.filter((r) => r.url.startsWith('/content')).length).toBeGreaterThan(0);
    expect(logLines.join('\n')).not.toContain(TOKEN);
  });

  it('imports a Kaspi price list and a CSV file', async () => {
    const s = await seller(false);
    const kaspi = await c.json('POST', `${s.base}/imports`, {
      cookie: s.cookie,
      body: { source: 'KASPI_XML', url: `${fakes.base}/kaspi.xml` },
    });
    expect(kaspi.statusCode).toBe(201);
    expect(kaspi.json()).toMatchObject({ warnings: ['kaspi.noPhotos'], counts: { total: 1 } });
    const [boots] = await rows(s.cookie, s.base, kaspi.json().id);
    expect(boots).toMatchObject({ categoryId: 202, colorId: 9, originalPrice: tenge(89990) });
    expect(boots!.sizes).toEqual([
      { label: '40', quantity: 1, sizeValueId: SIZE_EU(40) },
      { label: '41', quantity: 2, sizeValueId: SIZE_EU(41) },
    ]);
    const integrations = await c.json('GET', `${s.base}/integrations`, { cookie: s.cookie });
    expect(integrations.json()).toEqual([
      expect.objectContaining({ provider: 'KASPI_XML', kaspiUrl: `${fakes.base}/kaspi.xml` }),
    ]);
    const badUrl = await c.json('POST', `${s.base}/imports`, {
      cookie: s.cookie,
      body: { source: 'KASPI_XML', url: `${fakes.base}/missing.xml` },
    });
    expect(badUrl.json().errors).toEqual([{ path: 'url', message: 'url.httpError' }]);

    const csv = [
      'Артикул;Название;Бренд;Категория;Пол;Цвет;Размер;Остаток;Цена;Цена со скидкой;Фото',
      `H-1;Худи базовое;Uniqlo;Худи;Женский;Серый;M;2;20000;12990;${fakes.base}/photos/1.jpg`,
      'H-1;Худи базовое;Uniqlo;Худи;Женский;Серый;L;1;20000;12990;',
    ].join('\n');
    const boundary = `----ls${randomBytes(6).toString('hex')}`;
    const file = await h.app.inject({
      method: 'POST',
      url: `${s.base}/imports/file`,
      headers: { cookie: s.cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="goods.csv"\r\nContent-Type: text/csv\r\n\r\n`,
        ),
        Buffer.from(csv),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    expect(file.statusCode).toBe(201);
    expect(file.json().counts).toMatchObject({ total: 1, ready: 1, toPublish: 1 });

    // The store is not verified yet: publishing is refused, drafts are fine.
    const refused = await c.json('POST', `${s.base}/imports/${file.json().id}/publish`, {
      cookie: s.cookie,
      body: { mode: 'publish' },
    });
    expect(refused.json().errors).toEqual([{ path: 'mode', message: 'store.notVerified' }]);
    const drafts = await publishAll(s.cookie, s.base, file.json().id, 'draft');
    expect(drafts.map((p) => p.status)).toEqual(['PUBLISHED']);
    const [row] = await rows(s.cookie, s.base, file.json().id);
    const [draft] = await h.database.db
      .select()
      .from(products)
      .where(eq(products.id, row!.productId!));
    expect(draft!.status).toBe('DRAFT');
  });
});
