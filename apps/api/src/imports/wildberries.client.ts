import { setTimeout as sleep } from 'node:timers/promises';
import type { ApiEnv } from '../config/api-env';

export interface WbCard {
  nmID: number;
  vendorCode: string;
  brand: string;
  title: string;
  description: string;
  subjectName: string;
  photos: { big?: string }[];
  characteristics: { name: string; value: unknown }[];
  sizes: { chrtID: number; techSize: string; wbSize: string; skus: string[] }[];
}

export interface WbPrice {
  currency: string;
  /** Price before the seller's discount and the actual selling price, in currency units. */
  price: number;
  discountedPrice: number;
}

export type WildberriesErrorCode =
  'wb.invalidToken' | 'wb.forbidden' | 'wb.rateLimited' | 'wb.unavailable';

/** Carries only a code: request headers (with the token) never end up in errors or logs. */
export class WildberriesError extends Error {
  constructor(readonly code: WildberriesErrorCode) {
    super(code);
    this.name = 'WildberriesError';
  }
}

export interface WildberriesApi {
  /** Cheap call to check that a token works for the content API. */
  verifyToken(token: string): Promise<void>;
  listCards(token: string, max: number): Promise<WbCard[]>;
  listPrices(token: string): Promise<Map<number, WbPrice>>;
  /** Stock per WB size id (chrtID), summed over the seller's own (FBS) warehouses. */
  stocks(token: string, chrtIds: number[]): Promise<Map<number, number>>;
}

export const WILDBERRIES_API = Symbol('WILDBERRIES_API');

const TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;
const PAGE_SIZE = 100;
/** Content and prices APIs allow about 10 requests per 6 seconds per seller. */
const PACING_MS = 650;

type Json = Record<string, unknown>;

export class HttpWildberriesApi implements WildberriesApi {
  constructor(
    private readonly env: Pick<
      ApiEnv,
      'WB_CONTENT_API_URL' | 'WB_PRICES_API_URL' | 'WB_MARKETPLACE_API_URL'
    >,
  ) {}

  async verifyToken(token: string): Promise<void> {
    await this.request(token, `${this.env.WB_CONTENT_API_URL}/content/v2/get/cards/list`, {
      method: 'POST',
      body: { settings: { cursor: { limit: 1 }, filter: { withPhoto: -1 } } },
    });
  }

  async listCards(token: string, max: number): Promise<WbCard[]> {
    const cards: WbCard[] = [];
    let cursor: { updatedAt?: string; nmID?: number } = {};
    while (cards.length < max) {
      const page = (await this.request(
        token,
        `${this.env.WB_CONTENT_API_URL}/content/v2/get/cards/list`,
        {
          method: 'POST',
          body: {
            settings: {
              sort: { ascending: true },
              cursor: { limit: PAGE_SIZE, ...cursor },
              filter: { withPhoto: -1 },
            },
          },
        },
      )) as { cards?: WbCard[]; cursor?: { updatedAt?: string; nmID?: number; total?: number } };
      const batch = page.cards ?? [];
      cards.push(...batch);
      if (batch.length < PAGE_SIZE || !page.cursor?.nmID) break;
      cursor = { updatedAt: page.cursor.updatedAt, nmID: page.cursor.nmID };
      await sleep(PACING_MS);
    }
    return cards.slice(0, max);
  }

  async listPrices(token: string): Promise<Map<number, WbPrice>> {
    const prices = new Map<number, WbPrice>();
    const limit = 1000;
    for (let offset = 0; offset < 20_000; offset += limit) {
      const page = (await this.request(
        token,
        `${this.env.WB_PRICES_API_URL}/api/v2/list/goods/filter?limit=${limit}&offset=${offset}`,
        { method: 'GET' },
      )) as {
        data?: {
          listGoods?: {
            nmID: number;
            currencyIsoCode4217?: string;
            sizes?: { price?: number; discountedPrice?: number }[];
          }[];
        };
      };
      const goods = page.data?.listGoods ?? [];
      for (const good of goods) {
        const sizes = good.sizes ?? [];
        const price = Math.max(0, ...sizes.map((size) => size.price ?? 0));
        const discounted = sizes
          .map((size) => size.discountedPrice ?? 0)
          .filter((value) => value > 0);
        if (price <= 0) continue;
        prices.set(good.nmID, {
          currency: good.currencyIsoCode4217 ?? 'RUB',
          price,
          discountedPrice: discounted.length ? Math.min(...discounted) : price,
        });
      }
      if (goods.length < limit) break;
      await sleep(PACING_MS);
    }
    return prices;
  }

  async stocks(token: string, chrtIds: number[]): Promise<Map<number, number>> {
    const totals = new Map<number, number>();
    if (chrtIds.length === 0) return totals;
    const warehouses = (await this.request(
      token,
      `${this.env.WB_MARKETPLACE_API_URL}/api/v3/warehouses`,
      { method: 'GET' },
    )) as { id: number; isDeleting?: boolean }[];
    for (const warehouse of warehouses.filter((w) => !w.isDeleting)) {
      for (let i = 0; i < chrtIds.length; i += 1000) {
        const page = (await this.request(
          token,
          `${this.env.WB_MARKETPLACE_API_URL}/api/v3/stocks/${encodeURIComponent(String(warehouse.id))}`,
          { method: 'POST', body: { chrtIds: chrtIds.slice(i, i + 1000) } },
        )) as { stocks?: { chrtId: number; amount: number }[] };
        for (const stock of page.stocks ?? []) {
          totals.set(stock.chrtId, (totals.get(stock.chrtId) ?? 0) + Math.max(0, stock.amount));
        }
        await sleep(PACING_MS);
      }
    }
    return totals;
  }

  private async request(
    token: string,
    url: string,
    init: { method: 'GET' | 'POST'; body?: Json },
  ): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: init.method,
          headers: {
            Authorization: token,
            Accept: 'application/json',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: init.body ? JSON.stringify(init.body) : undefined,
          signal: AbortSignal.timeout(TIMEOUT_MS),
          redirect: 'error',
        });
      } catch {
        if (attempt < MAX_ATTEMPTS) {
          await sleep(1000 * attempt);
          continue;
        }
        throw new WildberriesError('wb.unavailable');
      }
      if (response.ok)
        return response.json().catch(() => {
          throw new WildberriesError('wb.unavailable');
        });
      await response.body?.cancel();
      if (response.status === 401) throw new WildberriesError('wb.invalidToken');
      if (response.status === 403) throw new WildberriesError('wb.forbidden');
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= MAX_ATTEMPTS)
        throw new WildberriesError(response.status === 429 ? 'wb.rateLimited' : 'wb.unavailable');
      const retryAfter = Number(
        response.headers.get('x-ratelimit-retry') ?? response.headers.get('retry-after') ?? 0,
      );
      await sleep(Math.min(Math.max(retryAfter * 1000, 1000 * attempt), 10_000));
    }
  }
}
