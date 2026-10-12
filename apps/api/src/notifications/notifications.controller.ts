import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import {
  markNotificationsReadRequestSchema,
  notificationListQuerySchema,
  type NotificationList,
  notificationListSchema,
} from '@lastsize/contracts';
import type { FastifyRequest } from 'fastify';
import { EMPTY, type Observable } from 'rxjs';
import type { z } from 'zod';
import { Public, RequireStoreAccess } from '../auth/decorators';
import { CustomerSessionService } from '../customer/customer-session.service';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { NotificationStream } from './notification-stream';
import { NotificationsService, type Recipient } from './notifications.service';

type ListQuery = z.output<typeof notificationListQuerySchema>;
type ReadBody = z.output<typeof markNotificationsReadRequestSchema>;

/** The guest buyer's notifications (device cookie). */
@Controller('customer/notifications')
export class CustomerNotificationsController {
  constructor(
    private readonly sessions: CustomerSessionService,
    private readonly notifications: NotificationsService,
    private readonly stream: NotificationStream,
  ) {}

  private async recipient(request: FastifyRequest): Promise<Recipient | null> {
    const customer = await this.sessions.resolve(request);
    return customer ? { type: 'CUSTOMER', id: customer.id } : null;
  }

  @Public()
  @Get()
  async list(
    @Req() request: FastifyRequest,
    @Query(new ZodValidationPipe(notificationListQuerySchema)) query: ListQuery,
  ): Promise<NotificationList> {
    const recipient = await this.recipient(request);
    if (!recipient) return { items: [], unread: 0 };
    return notificationListSchema.parse({
      items: await this.notifications.list(recipient, query.lang, query.before),
      unread: await this.notifications.unread(recipient),
    });
  }

  @Public()
  @Post('read')
  @HttpCode(204)
  async read(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(markNotificationsReadRequestSchema)) body: ReadBody,
  ): Promise<void> {
    const recipient = await this.recipient(request);
    if (recipient)
      await this.notifications.markRead(recipient, body.all ? 'all' : (body.ids ?? []));
  }

  @Public()
  @Sse('stream')
  async events(@Req() request: FastifyRequest): Promise<Observable<MessageEvent>> {
    const recipient = await this.recipient(request);
    return recipient ? this.stream.stream(recipient) : EMPTY;
  }
}

/** Notifications of a store, shared by its members. */
@Controller('seller/stores/:storeId/notifications')
export class StoreNotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly stream: NotificationStream,
  ) {}

  @Get()
  @RequireStoreAccess('order:read_store')
  async list(
    @Param('storeId') storeId: string,
    @Query(new ZodValidationPipe(notificationListQuerySchema)) query: ListQuery,
  ): Promise<NotificationList> {
    const recipient: Recipient = { type: 'STORE', id: storeId };
    return notificationListSchema.parse({
      items: await this.notifications.list(recipient, query.lang, query.before),
      unread: await this.notifications.unread(recipient),
    });
  }

  @Post('read')
  @HttpCode(204)
  @RequireStoreAccess('order:read_store')
  async read(
    @Param('storeId') storeId: string,
    @Body(new ZodValidationPipe(markNotificationsReadRequestSchema)) body: ReadBody,
  ): Promise<void> {
    await this.notifications.markRead(
      { type: 'STORE', id: storeId },
      body.all ? 'all' : (body.ids ?? []),
    );
  }

  @Sse('stream')
  @RequireStoreAccess('order:read_store')
  events(@Param('storeId') storeId: string): Observable<MessageEvent> {
    return this.stream.stream({ type: 'STORE', id: storeId });
  }
}
