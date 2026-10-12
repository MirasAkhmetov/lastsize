import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Logger } from '@lastsize/logger';
import { Redis } from 'ioredis';
import { filter, interval, map, merge, Observable, Subject } from 'rxjs';
import { API_ENV, type ApiEnv } from '../config/api-env';
import { APP_LOGGER } from '../logging';
import { NotificationsService, type Recipient } from './notifications.service';

/** Proxies drop quiet connections; a comment line every 25 s keeps the stream open. */
const HEARTBEAT_MS = 25_000;

/**
 * Live updates for open pages (server-sent events). One Redis subscription per API process is
 * shared by all connections; each page only receives events addressed to it, and only the id —
 * the page then reads the notification through the normal, access-checked API.
 */
@Injectable()
export class NotificationStream implements OnModuleInit, OnApplicationShutdown {
  private readonly events = new Subject<{ id: string; type: string; recipientId: string }>();
  private subscriber: Redis | null = null;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscriber = new Redis(this.env.REDIS_URL, {
      lazyConnect: true,
      connectionName: 'lastsize-notify-sub',
    });
    this.subscriber.on('error', (error) =>
      this.logger.warn({ err: error }, 'notify subscriber error'),
    );
    this.subscriber.on('message', (_channel, message) => {
      try {
        this.events.next(JSON.parse(message) as { id: string; type: string; recipientId: string });
      } catch {
        // Not ours; ignore.
      }
    });
    await this.subscriber
      .connect()
      .then(() => this.subscriber!.subscribe(this.notifications.pubsubChannel))
      .catch((error: unknown) => this.logger.warn({ err: error }, 'notify subscribe failed'));
  }

  async onApplicationShutdown(): Promise<void> {
    this.events.complete();
    await this.subscriber?.quit().catch(() => undefined);
  }

  stream(recipient: Recipient): Observable<MessageEvent> {
    return merge(
      this.events.pipe(
        filter((event) => event.type === recipient.type && event.recipientId === recipient.id),
        map((event) => ({ type: 'notification', data: { id: event.id } }) as MessageEvent),
      ),
      interval(HEARTBEAT_MS).pipe(map(() => ({ type: 'ping', data: '' }) as MessageEvent)),
    );
  }
}
