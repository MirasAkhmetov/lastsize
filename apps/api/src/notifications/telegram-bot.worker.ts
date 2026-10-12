import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { normalizeKzPhone } from '@lastsize/contracts';
import { type Database, eq, users } from '@lastsize/db';
import type { Logger } from '@lastsize/logger';
import type { Redis } from 'ioredis';
import { API_ENV, type ApiEnv } from '../config/api-env';
import { DATABASE, REDIS } from '../infrastructure/infrastructure.module';
import { APP_LOGGER } from '../logging';
import { RateLimiterService } from '../security/rate-limiter.service';
import { OneTimeTokens } from './one-time-tokens';
import { TELEGRAM_API, type TelegramApi, type TelegramUpdate } from './telegram.client';

const POLL_SECONDS = 25;
const OFFSET_KEY = 'tg:offset';
const RESET_LIMIT = { name: 'tg:reset', limit: 5, windowSeconds: 60 * 60 };

const TEXT = {
  linked: 'Готово! Уведомления о заказах магазина будут приходить сюда.',
  linkExpired: 'Ссылка устарела. Нажмите «Подключить Telegram» в кабинете продавца ещё раз.',
  hello:
    'Это бот LastSize для продавцов.\n\n• Уведомления о заказах: подключите бот в кабинете продавца.\n• Забыли пароль? Нажмите кнопку ниже и поделитесь номером телефона.',
  share: 'Поделиться номером',
  notOwn: 'Поделитесь, пожалуйста, своим номером — кнопкой ниже.',
  noAccount: 'Аккаунт продавца с этим номером не найден.',
  reset: 'Ссылка для нового пароля действует 30 минут:',
  resetButton: 'Задать новый пароль',
  tooMany: 'Слишком много попыток. Попробуйте через час.',
};

/**
 * The seller bot, by long polling (works before the domain is bought; no webhook needed).
 * - "/start <token>" from the seller portal links the Telegram account for order alerts.
 * - Sharing one's own phone contact gives a one-time password-reset link: Telegram vouches
 *   that the number belongs to this account, so no SMS is needed.
 */
@Injectable()
export class TelegramBotWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private running = false;
  private loop: Promise<void> | null = null;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(TELEGRAM_API) private readonly telegram: TelegramApi,
    private readonly tokens: OneTimeTokens,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.telegram.enabled) {
      this.logger.info('telegram bot disabled (no TELEGRAM_BOT_TOKEN)');
      return;
    }
    this.running = true;
    this.loop = this.poll();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await this.loop;
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const offset = Number((await this.redis.get(OFFSET_KEY)) ?? 0);
        const updates = await this.telegram.getUpdates(offset, POLL_SECONDS);
        for (const update of updates) {
          await this.handle(update).catch((error: unknown) =>
            this.logger.warn({ err: error, updateId: update.update_id }, 'telegram update failed'),
          );
          await this.redis.set(OFFSET_KEY, String(update.update_id + 1));
        }
      } catch (error) {
        this.logger.warn({ err: error }, 'telegram polling failed');
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  async handle(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message?.from || message.chat.type !== 'private') return;
    const chatId = message.chat.id;
    const telegramUserId = message.from.id;

    const start = /^\/start(?:\s+([A-Za-z0-9_-]{20,64}))?$/.exec(message.text?.trim() ?? '');
    if (start?.[1]) {
      const userId = await this.tokens.consume('telegram-link', start[1]);
      if (!userId) return this.telegram.sendMessage(chatId, TEXT.linkExpired);
      await this.db.transaction(async (tx) => {
        // One Telegram account belongs to one seller account.
        await tx
          .update(users)
          .set({ telegramUserId: null })
          .where(eq(users.telegramUserId, BigInt(telegramUserId)));
        await tx
          .update(users)
          .set({ telegramUserId: BigInt(telegramUserId) })
          .where(eq(users.id, userId));
      });
      return this.telegram.sendMessage(chatId, TEXT.linked, { kind: 'remove' });
    }

    if (message.contact) {
      if (message.contact.user_id !== telegramUserId)
        return this.telegram.sendMessage(chatId, TEXT.notOwn, {
          kind: 'shareContact',
          label: TEXT.share,
        });
      try {
        await this.rateLimiter.consume(RESET_LIMIT, String(telegramUserId));
      } catch {
        return this.telegram.sendMessage(chatId, TEXT.tooMany, { kind: 'remove' });
      }
      const phone = normalizeKzPhone(message.contact.phone_number);
      const [user] = phone
        ? await this.db
            .select({ id: users.id, status: users.status })
            .from(users)
            .where(eq(users.phone, phone))
        : [];
      if (!user || user.status !== 'ACTIVE')
        return this.telegram.sendMessage(chatId, TEXT.noAccount, { kind: 'remove' });
      const token = await this.tokens.issue('password-reset', user.id);
      await this.telegram.sendMessage(chatId, TEXT.reset, {
        kind: 'link',
        label: TEXT.resetButton,
        url: `${this.env.PUBLIC_SITE_URL}/seller/reset?token=${token}`,
      });
      return;
    }

    return this.telegram.sendMessage(chatId, TEXT.hello, {
      kind: 'shareContact',
      label: TEXT.share,
    });
  }
}
