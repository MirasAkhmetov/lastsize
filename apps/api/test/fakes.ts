import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** The fake WB accepts only this token. */
export const TOKEN = `wb-${randomBytes(24).toString('base64url')}`;

function body(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    request.on('data', (chunk: Buffer) => (data += chunk.toString()));
    request.on('end', () => resolve(data));
  });
}

/** A local stand-in for the Wildberries APIs, a Kaspi price list and a photo CDN. */
export async function startFakes(photo: Buffer) {
  const requests: { url: string; authorization: string | undefined }[] = [];
  /** What the marketplaces show; tests change it to simulate sales there. */
  const state = {
    amounts: { 501: 3, 502: 0, 503: 2, 601: 4, 602: 1, 701: 5 } as Record<number, number>,
    prices: {
      1001: { price: 50000, discounted: 40000 },
      1002: { price: 30000, discounted: 30000 },
    } as Record<number, { price: number; discounted: number }>,
    readOnly: false,
    pushes: [] as { chrtId: number; amount: number }[][],
    kaspiStock: { 'K-40': 1, 'K-41': 2 } as Record<string, number>,
    kaspiPrice: 89990,
  };
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
      const offer = (sku: string, size: number) =>
        `<offer sku="${sku}"><model>Ботинки Timberland желтые ${size}</model><brand>Timberland</brand>
    <availabilities><availability available="yes" storeId="PP1" stockCount="${state.kaspiStock[sku] ?? 0}"/></availabilities><price>${state.kaspiPrice}</price></offer>`;
      return response.end(`<?xml version="1.0" encoding="utf-8"?>
<kaspi_catalog xmlns="kaspiShopping"><offers>
  ${offer('K-40', 40)}
  ${offer('K-41', 41)}
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
          listGoods: Object.entries(state.prices).map(([nmID, price]) => ({
            nmID: Number(nmID),
            currencyIsoCode4217: 'KZT',
            sizes: [{ sizeID: 1, price: price.price, discountedPrice: price.discounted }],
          })),
        },
      });
    }
    if (url === '/api/v3/warehouses') return json(200, [{ id: 7, name: 'Склад Алматы' }]);
    if (url === '/api/v3/stocks/7' && request.method === 'POST') {
      const { chrtIds } = JSON.parse(await body(request)) as { chrtIds: number[] };
      return json(200, {
        stocks: chrtIds.map((chrtId) => ({ chrtId, amount: state.amounts[chrtId] ?? 0 })),
      });
    }
    if (url === '/api/v3/stocks/7' && request.method === 'PUT') {
      if (state.readOnly) return json(403, { title: 'read-only token' });
      const { stocks } = JSON.parse(await body(request)) as {
        stocks: { chrtId: number; amount: number }[];
      };
      state.pushes.push(stocks);
      for (const stock of stocks) state.amounts[stock.chrtId] = stock.amount;
      response.writeHead(204);
      return response.end();
    }
    return json(404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    requests,
    state,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
