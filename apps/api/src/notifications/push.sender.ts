import webpush from 'web-push';
import type { ApiEnv } from '../config/api-env';

/**
 * The server sends to the endpoint a browser hands us, so only real push services are allowed:
 * nobody can make the API call an arbitrary address.
 */
const PUSH_SERVICE_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /\.notify\.windows\.com$/,
];

export function isPushServiceEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === 'https:' &&
      url.port === '' &&
      PUSH_SERVICE_HOSTS.some((host) => host.test(url.hostname))
    );
  } catch {
    return false;
  }
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSender {
  readonly publicKey: string | null;
  /** 'gone' when the browser unsubscribed: the subscription should be deleted. */
  send(
    target: PushTarget,
    payload: { title: string; body: string; url: string },
  ): Promise<'sent' | 'gone'>;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');

export class WebPushSender implements PushSender {
  readonly publicKey: string | null;

  constructor(
    private readonly env: Pick<ApiEnv, 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT'>,
  ) {
    this.publicKey = env.VAPID_PUBLIC_KEY ?? null;
  }

  async send(
    target: PushTarget,
    payload: { title: string; body: string; url: string },
  ): Promise<'sent' | 'gone'> {
    if (!this.env.VAPID_PUBLIC_KEY || !this.env.VAPID_PRIVATE_KEY) return 'gone';
    if (!isPushServiceEndpoint(target.endpoint)) return 'gone';
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        {
          TTL: 24 * 60 * 60,
          timeout: 15_000,
          vapidDetails: {
            subject: this.env.VAPID_SUBJECT,
            publicKey: this.env.VAPID_PUBLIC_KEY,
            privateKey: this.env.VAPID_PRIVATE_KEY,
          },
        },
      );
      return 'sent';
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      // Not chained on purpose: web-push errors carry the endpoint, a capability URL that must
      // not reach logs.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`push failed with ${status ?? 'network error'}`);
    }
  }
}
