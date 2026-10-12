import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq, notificationDeliveries, pushSubscriptions, sellerOrders, users } from '@lastsize/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import webpush from 'web-push';
import { API_ENV } from '../src/config/api-env';
import { DATABASE, REDIS } from '../src/infrastructure/infrastructure.module';
import { APP_LOGGER } from '../src/logging';
import { DeliveryWorker } from '../src/notifications/delivery.worker';
import { NotificationsService } from '../src/notifications/notifications.service';
import { OneTimeTokens } from '../src/notifications/one-time-tokens';
import type { PushSender, PushTarget } from '../src/notifications/push.sender';
import { TELEGRAM_API, type TelegramApi } from '../src/notifications/telegram.client';
import { TelegramBotWorker } from '../src/notifications/telegram-bot.worker';
import { OrdersService } from '../src/orders/orders.service';
import { RateLimiterService } from '../src/security/rate-limiter.service';
import { createClient, PASSWORD } from './client';
import { type Harness, startHarness, storageEnabled } from './harness';
import { shopHelpers } from './shop';

const BOT_TOKEN = `123456789:${'T'.repeat(35)}`;

/** A stand-in for api.telegram.org that records what the bot sends. */
async function fakeTelegram() {
  const sent: { chatId: number; text: string; markup: unknown }[] = [];
  const blocked = new Set<number>();
  const server: Server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    request.on('end', () => {
      const ok = request.url?.startsWith(`/bot${BOT_TOKEN}/`);
      const body = raw
        ? (JSON.parse(raw) as { chat_id: number; text: string; reply_markup?: unknown })
        : null;
      response.setHeader('content-type', 'application/json');
      if (!ok) return response.writeHead(401).end('{"ok":false}');
      if (request.url?.endsWith('/sendMessage') && body) {
        if (blocked.has(body.chat_id))
          return response.writeHead(403).end('{"ok":false,"description":"bot was blocked"}');
        sent.push({ chatId: body.chat_id, text: body.text, markup: body.reply_markup });
      }
      response.end(
        JSON.stringify({ ok: true, result: request.url?.endsWith('/getUpdates') ? [] : true }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, sent, blocked, close: () => server.close() };
}

class FakePush implements PushSender {
  readonly publicKey = 'fake';
  readonly delivered: { endpoint: string; title: string; url: string }[] = [];
  gone = false;
  async send(target: PushTarget, payload: { title: string; body: string; url: string }) {
    if (this.gone) return 'gone' as const;
    this.delivered.push({ endpoint: target.endpoint, title: payload.title, url: payload.url });
    return 'sent' as const;
  }
}

describe.runIf(storageEnabled)('notifications', { timeout: 30_000 }, () => {
  let h: Harness;
  let c: ReturnType<typeof createClient>;
  let shop: Awaited<ReturnType<typeof shopHelpers>>;
  let telegram: Awaited<ReturnType<typeof fakeTelegram>>;
  let bot: TelegramBotWorker;
  let push: FakePush;
  let delivery: DeliveryWorker;
  const vapid = webpush.generateVAPIDKeys();

  beforeAll(async () => {
    telegram = await fakeTelegram();
    h = await startHarness({
      env: {
        TELEGRAM_BOT_TOKEN: BOT_TOKEN,
        TELEGRAM_BOT_USERNAME: 'LastSizeTestBot',
        TELEGRAM_API_URL: telegram.base,
        PUBLIC_SITE_URL: 'https://lastsize.test',
        VAPID_PUBLIC_KEY: vapid.publicKey,
        VAPID_PRIVATE_KEY: vapid.privateKey,
      },
    });
    c = createClient(h);
    shop = await shopHelpers(h, c);
    const tg = h.app.get<TelegramApi>(TELEGRAM_API);
    bot = new TelegramBotWorker(
      h.app.get(API_ENV),
      h.app.get(APP_LOGGER),
      h.app.get(DATABASE),
      h.app.get(REDIS),
      tg,
      h.app.get(OneTimeTokens),
      h.app.get(RateLimiterService),
    );
    push = new FakePush();
    delivery = new DeliveryWorker(
      h.app.get(API_ENV),
      h.app.get(APP_LOGGER),
      h.app.get(DATABASE),
      tg,
      push,
      h.app.get(NotificationsService),
    );
  });
  afterAll(async () => {
    await h?.close();
    telegram?.close();
  });

  const message = (
    from: number,
    text?: string,
    contact?: { phone_number: string; user_id: number },
  ) => ({
    update_id: Math.floor(Math.random() * 1e9),
    message: { chat: { id: from, type: 'private' }, from: { id: from }, text, contact },
  });

  it('links Telegram, alerts the store about orders and tells the buyer about each step', async () => {
    const store = await shop.storeWithProduct({ 40: 3 });
    const seller = store.seller;
    const status = await c.json('GET', '/api/v1/seller/telegram', { cookie: seller.cookie });
    expect(status.json()).toEqual({ available: true, linked: false });

    const link = (
      await c.json('POST', '/api/v1/seller/telegram/link', { cookie: seller.cookie })
    ).json();
    const token = /start=([\w-]+)$/.exec(link.url)![1]!;
    expect(link.url).toMatch(/^https:\/\/t\.me\/LastSizeTestBot\?start=/);
    const chatId = 700_000_000 + Math.floor(Math.random() * 1e6);
    await bot.handle(message(chatId, `/start ${token}`));
    expect(telegram.sent.at(-1)).toMatchObject({ chatId, text: expect.stringContaining('Готово') });
    expect(
      (await c.json('GET', '/api/v1/seller/telegram', { cookie: seller.cookie })).json().linked,
    ).toBe(true);
    // A link works once.
    await bot.handle(message(chatId + 1, `/start ${token}`));
    expect(telegram.sent.at(-1)!.text).toContain('устарела');

    // A buyer orders: the store gets it in the centre and in Telegram.
    const b = shop.buyer();
    await b.call('POST', '/cart/items', { variantId: store.variants[40]! });
    const placed = await shop.checkout(
      b,
      [{ storeId: store.storeId, type: 'PICKUP' }],
      randomUUID(),
      '+77015550101',
    );
    const number = placed.json().number as number;
    const storeList = await c.json('GET', `/api/v1/seller/stores/${store.storeId}/notifications`, {
      cookie: seller.cookie,
    });
    expect(storeList.json()).toMatchObject({ unread: 1 });
    expect(storeList.json().items[0]).toMatchObject({
      type: 'order.new',
      title: `Новый заказ №${number}`,
      read: false,
      link: expect.stringMatching(/^\/seller\/orders\//),
    });
    const result = await delivery.process();
    expect(result.sent).toBeGreaterThanOrEqual(1);
    const alert = telegram.sent.find(
      (entry) => entry.chatId === chatId && entry.text.includes(`№${number}`),
    )!;
    expect(alert.text).toContain('самовывоз');
    expect(JSON.stringify(alert.markup)).toContain('https://lastsize.test/seller/orders/');

    // The store confirms: the buyer is told, in their language.
    const partId = storeList.json().items[0].link.split('/').at(-1);
    await c.json('POST', `/api/v1/seller/stores/${store.storeId}/orders/${partId}/actions`, {
      cookie: seller.cookie,
      body: { action: 'confirm' },
    });
    const forBuyer = (await b.call('GET', '/customer/notifications')).json();
    expect(forBuyer).toMatchObject({ unread: 1 });
    expect(forBuyer.items[0]).toMatchObject({ type: 'order.confirmed', link: `/orders/${number}` });
    expect(forBuyer.items[0].title).toBe(`Заказ №${number} подтверждён`);
    const kk = (await b.call('GET', '/customer/notifications?lang=kk')).json();
    expect(kk.items[0].title).toBe(`№${number} тапсырыс расталды`);
    // Another device sees nothing; another store's member cannot read this store's centre.
    expect((await shop.buyer().call('GET', '/customer/notifications')).json()).toEqual({
      items: [],
      unread: 0,
    });
    const stranger = await c.register();
    expect(
      (
        await c.json('GET', `/api/v1/seller/stores/${store.storeId}/notifications`, {
          cookie: stranger.cookie,
        })
      ).statusCode,
    ).toBe(404);

    expect((await b.call('POST', '/customer/notifications/read', { all: true })).statusCode).toBe(
      204,
    );
    expect((await b.call('GET', '/customer/notifications')).json().unread).toBe(0);

    // The seller blocked the bot: Telegram is unlinked instead of failing forever.
    telegram.blocked.add(chatId);
    await c.json('POST', `/api/v1/seller/stores/${store.storeId}/orders/${partId}/actions`, {
      cookie: seller.cookie,
      body: { action: 'cancel', reason: 'store.outOfStock' },
    });
    const b2 = shop.buyer();
    await b2.call('POST', '/cart/items', { variantId: store.variants[40]! });
    await shop.checkout(
      b2,
      [{ storeId: store.storeId, type: 'PICKUP' }],
      randomUUID(),
      '+77015550102',
    );
    await delivery.process();
    const [user] = await h.database.db
      .select({ telegram: users.telegramUserId })
      .from(users)
      .where(eq(users.id, seller.userId));
    expect(user!.telegram).toBeNull();
  });

  it('reminds a store once after two hours without an answer', async () => {
    const store = await shop.storeWithProduct({ 41: 2 });
    const b = shop.buyer();
    await b.call('POST', '/cart/items', { variantId: store.variants[41]! });
    await shop.checkout(
      b,
      [{ storeId: store.storeId, type: 'PICKUP' }],
      randomUUID(),
      '+77015550103',
    );
    await h.database.db
      .update(sellerOrders)
      .set({ createdAt: new Date(Date.now() - 3 * 3_600_000) })
      .where(eq(sellerOrders.storeId, store.storeId));
    const orders = h.app.get(OrdersService);
    expect(await orders.remindUnconfirmed()).toBeGreaterThanOrEqual(1);
    await orders.remindUnconfirmed();
    const list = (
      await c.json('GET', `/api/v1/seller/stores/${store.storeId}/notifications`, {
        cookie: store.seller.cookie,
      })
    ).json();
    expect(
      list.items.filter((item: { type: string }) => item.type === 'order.reminder'),
    ).toHaveLength(1);
  });

  it('resets a seller password through a phone number Telegram vouches for', async () => {
    const seller = await c.register();
    const chatId = 800_000_000 + Math.floor(Math.random() * 1e6);
    // Someone else's contact does not count.
    await bot.handle(
      message(chatId, undefined, { phone_number: seller.phone, user_id: chatId + 5 }),
    );
    expect(telegram.sent.at(-1)!.text).toContain('своим номером');

    await bot.handle(
      message(chatId, undefined, { phone_number: seller.phone.replace('+', ''), user_id: chatId }),
    );
    const reply = telegram.sent.at(-1)!;
    const url = JSON.stringify(reply.markup).match(
      /https:\/\/lastsize\.test\/seller\/reset\?token=([\w-]+)/,
    )!;
    const token = url[1]!;

    const weak = await c.json('POST', '/api/v1/auth/password-reset', {
      body: { token, password: 'short' },
    });
    expect(weak.statusCode).toBe(422);
    const reset = await c.json('POST', '/api/v1/auth/password-reset', {
      body: { token, password: 'a-brand-new-password' },
    });
    expect(reset.statusCode).toBe(204);
    // Old sessions are signed out; the old password no longer works; the token is spent.
    expect((await c.json('GET', '/api/v1/auth/me', { cookie: seller.cookie })).statusCode).toBe(
      401,
    );
    expect((await c.login(seller.phone, PASSWORD)).statusCode).toBe(401);
    expect((await c.login(seller.phone, 'a-brand-new-password')).statusCode).toBe(200);
    const again = await c.json('POST', '/api/v1/auth/password-reset', {
      body: { token, password: 'another-new-password' },
    });
    expect(again.json().errors).toEqual([{ path: 'token', message: 'reset.invalid' }]);
    const [user] = await h.database.db
      .select({ verified: users.phoneVerifiedAt })
      .from(users)
      .where(eq(users.id, seller.userId));
    expect(user!.verified).not.toBeNull();

    // A number without an account.
    await bot.handle(message(chatId, undefined, { phone_number: '+77779990000', user_id: chatId }));
    expect(telegram.sent.at(-1)!.text).toContain('не найден');
  });

  it('sends browser push only to real push services, and forgets dead subscriptions', async () => {
    const b = shop.buyer();
    const config = await b.call('GET', '/push/config');
    expect(config.json()).toEqual({ publicKey: vapid.publicKey });
    const keys = {
      p256dh: 'B'.repeat(87),
      auth: 'A'.repeat(22),
    };
    const internal = await b.call('POST', '/push/subscriptions', {
      endpoint: 'https://169.254.169.254/latest/meta-data',
      keys,
    });
    expect(internal.json().errors).toEqual([{ path: 'endpoint', message: 'push.endpoint' }]);
    const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
    expect((await b.call('POST', '/push/subscriptions', { endpoint, keys })).statusCode).toBe(204);

    // An order for this buyer gets confirmed: the browser is told.
    const store = await shop.storeWithProduct({ 42: 2 });
    await b.call('POST', '/cart/items', { variantId: store.variants[42]! });
    const placed = await shop.checkout(
      b,
      [{ storeId: store.storeId, type: 'PICKUP' }],
      randomUUID(),
      '+77015550104',
    );
    const part = (await b.call('GET', `/orders/${placed.json().number}`)).json().parts[0];
    await c.json('POST', `/api/v1/seller/stores/${store.storeId}/orders/${part.id}/actions`, {
      cookie: store.seller.cookie,
      body: { action: 'confirm' },
    });
    await delivery.process();
    expect(push.delivered.find((entry) => entry.endpoint === endpoint)).toMatchObject({
      url: `https://lastsize.test/orders/${placed.json().number}`,
    });

    // The browser unsubscribed: the subscription is deleted, the delivery is not retried.
    push.gone = true;
    await c.json('POST', `/api/v1/seller/stores/${store.storeId}/orders/${part.id}/actions`, {
      cookie: store.seller.cookie,
      body: { action: 'readyForPickup' },
    });
    await delivery.process();
    expect(
      await h.database.db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, endpoint)),
    ).toEqual([]);
    const pending = await h.database.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.status, 'PENDING'));
    expect(pending.filter((row) => row.channel === 'WEB_PUSH')).toEqual([]);
    push.gone = false;
  });

  it('streams new notifications to an open seller page', async () => {
    const store = await shop.storeWithProduct({ 43: 2 });
    await h.app.listen({ port: 0, host: '127.0.0.1' });
    const address = h.app.getHttpServer().address() as AddressInfo;
    const controller = new AbortController();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/seller/stores/${store.storeId}/notifications/stream`,
      { headers: { cookie: store.seller.cookie }, signal: controller.signal },
    );
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();

    const b = shop.buyer();
    await b.call('POST', '/cart/items', { variantId: store.variants[43]! });
    await shop.checkout(
      b,
      [{ storeId: store.storeId, type: 'PICKUP' }],
      randomUUID(),
      '+77015550105',
    );

    let received = '';
    const decoder = new TextDecoder();
    while (!received.includes('event: notification')) {
      const { value, done } = await reader.read();
      if (done) break;
      received += decoder.decode(value);
    }
    controller.abort();
    expect(received).toMatch(/event: notification\n(?:id: \d+\n)?data: \{"id":"[0-9a-f-]{36}"\}/);
  });
});
