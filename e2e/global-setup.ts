import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createDatabase, createPool, eq, stores } from '@lastsize/db';
import sharp from 'sharp';

const API = process.env.E2E_API_URL ?? 'http://localhost:4000';
export const FIXTURE = new URL('./.fixture.json', import.meta.url);

export interface Fixture {
  stores: { name: string; phone: string; password: string; productPath: string; size: string }[];
}

async function call(path: string, init: { cookie?: string; body?: unknown; form?: FormData } = {}) {
  const response = await fetch(`${API}/api/v1${path}`, {
    method: init.body !== undefined || init.form ? 'POST' : 'GET',
    headers: {
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
  if (!response.ok) throw new Error(`${path} → ${response.status} ${await response.text()}`);
  return response;
}

const schedule = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, [['00:00', '23:59']]]),
);

/** Two verified stores with one pair of sneakers each, made through the real API. */
export default async function globalSetup(): Promise<void> {
  const pool = createPool({ connectionString: process.env.DATABASE_URL!, applicationName: 'e2e' });
  const db = createDatabase(pool);
  const photo = await sharp({
    create: { width: 900, height: 1200, channels: 3, background: { r: 40, g: 70, b: 120 } },
  })
    .jpeg()
    .toBuffer();
  const fixture: Fixture = { stores: [] };
  try {
    for (const [index, size] of [40, 42].entries()) {
      const phone = `+7708${String(Date.now()).slice(-6)}${index}`;
      const password = `e2e-${randomBytes(9).toString('base64url')}`;
      const name = `E2E Shop ${index + 1} ${randomBytes(2).toString('hex')}`;
      const registered = await call('/auth/register', {
        body: { phone, name: 'E2E Seller', password },
      });
      const cookie = registered.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
      const store = (await (
        await call('/seller/stores', {
          cookie,
          body: {
            name,
            binIin: '971240001315',
            location: { cityId: 1, address: 'Абая 10, ТЦ E2E', phone: '+77011234567', schedule },
          },
        })
      ).json()) as { id: string };
      await db
        .update(stores)
        .set({ status: 'VERIFIED', verifiedAt: new Date(Date.now() - 365 * 86_400_000) })
        .where(eq(stores.id, store.id));
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(photo)], { type: 'image/jpeg' }), 'photo.jpg');
      const media = (await (
        await call(`/seller/stores/${store.id}/media`, { cookie, form })
      ).json()) as { id: string };
      const product = (await (
        await call(`/seller/stores/${store.id}/products`, {
          cookie,
          body: {
            title: `Кроссовки E2E ${index + 1}`,
            brand: 'Nike',
            categoryId: 201,
            gender: 'WOMEN',
            colorId: 1,
            mediaIds: [media.id],
            originalPrice: 6_000_000,
            salePrice: 3_000_000,
            variants: [{ sizeValueId: 2000 + (size - 19), quantity: 5 }],
            publish: true,
          },
        })
      ).json()) as { slug: string; shortId: string };
      fixture.stores.push({
        name,
        phone,
        password,
        productPath: `${product.slug}-${product.shortId}`,
        size: String(size),
      });
    }
  } finally {
    await pool.end();
  }
  await writeFile(FIXTURE, JSON.stringify(fixture, null, 2));
}
