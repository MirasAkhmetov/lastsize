import { setTimeout as sleep } from 'node:timers/promises';
import type { ApiEnv } from '../config/api-env';

export interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number; type: string };
    from?: { id: number; language_code?: string };
    text?: string;
    contact?: { phone_number: string; user_id?: number };
  };
}

export type TelegramErrorCode = 'tg.forbidden' | 'tg.badRequest' | 'tg.unavailable';

/** Carries only a code: the bot token is part of every API URL and must never be logged. */
export class TelegramError extends Error {
  constructor(readonly code: TelegramErrorCode) {
    super(code);
    this.name = 'TelegramError';
  }
}

export interface TelegramApi {
  readonly enabled: boolean;
  readonly username: string | null;
  getUpdates(offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]>;
  sendMessage(chatId: number, text: string, keyboard?: TelegramKeyboard): Promise<void>;
}

export type TelegramKeyboard =
  | { kind: 'shareContact'; label: string }
  | { kind: 'remove' }
  | { kind: 'link'; label: string; url: string };

export const TELEGRAM_API = Symbol('TELEGRAM_API');

const ATTEMPTS = 3;

/** Telegram Bot API over HTTPS. Without a configured token every call is a no-op. */
export class HttpTelegramApi implements TelegramApi {
  readonly enabled: boolean;
  readonly username: string | null;

  constructor(
    private readonly env: Pick<
      ApiEnv,
      'TELEGRAM_BOT_TOKEN' | 'TELEGRAM_BOT_USERNAME' | 'TELEGRAM_API_URL'
    >,
  ) {
    this.enabled = Boolean(env.TELEGRAM_BOT_TOKEN);
    this.username = env.TELEGRAM_BOT_USERNAME ?? null;
  }

  async getUpdates(offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]> {
    const result = await this.call(
      'getUpdates',
      { offset, timeout: timeoutSeconds, allowed_updates: ['message'] },
      (timeoutSeconds + 10) * 1000,
    );
    return (result as TelegramUpdate[] | null) ?? [];
  }

  async sendMessage(chatId: number, text: string, keyboard?: TelegramKeyboard): Promise<void> {
    const replyMarkup =
      keyboard?.kind === 'shareContact'
        ? {
            keyboard: [[{ text: keyboard.label, request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          }
        : keyboard?.kind === 'remove'
          ? { remove_keyboard: true }
          : keyboard?.kind === 'link'
            ? { inline_keyboard: [[{ text: keyboard.label, url: keyboard.url }]] }
            : undefined;
    await this.call(
      'sendMessage',
      {
        chat_id: chatId,
        text,
        link_preview_options: { is_disabled: true },
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      },
      15_000,
    );
  }

  private async call(method: string, body: object, timeoutMs: number): Promise<unknown> {
    if (!this.env.TELEGRAM_BOT_TOKEN) return null;
    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(
          `${this.env.TELEGRAM_API_URL}/bot${this.env.TELEGRAM_BOT_TOKEN}/${method}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
            redirect: 'error',
          },
        );
      } catch {
        if (attempt < ATTEMPTS) {
          await sleep(1000 * attempt);
          continue;
        }
        throw new TelegramError('tg.unavailable');
      }
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        result?: unknown;
        parameters?: { retry_after?: number };
      } | null;
      if (response.ok && payload?.ok) return payload.result ?? null;
      if (response.status === 403) throw new TelegramError('tg.forbidden');
      if (response.status === 400) throw new TelegramError('tg.badRequest');
      if ((response.status === 429 || response.status >= 500) && attempt < ATTEMPTS) {
        await sleep(Math.min((payload?.parameters?.retry_after ?? attempt) * 1000, 10_000));
        continue;
      }
      throw new TelegramError('tg.unavailable');
    }
  }
}
