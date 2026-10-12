import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  pushConfigSchema,
  pushSubscriptionRequestSchema,
  pushUnsubscribeRequestSchema,
} from '@lastsize/contracts';
import { and, type Database, eq, pushSubscriptions, users } from '@lastsize/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth, Public } from '../auth/decorators';
import { CustomerSessionService } from '../customer/customer-session.service';
import { DATABASE } from '../infrastructure/infrastructure.module';
import { RateLimiterService } from '../security/rate-limiter.service';
import { ValidationFailedException, ZodValidationPipe } from '../security/zod-validation.pipe';
import { OneTimeTokens } from './one-time-tokens';
import { isPushServiceEndpoint, PUSH_SENDER, type PushSender } from './push.sender';
import { TELEGRAM_API, type TelegramApi } from './telegram.client';

const LINK_LIMIT = { name: 'telegram:link', limit: 10, windowSeconds: 60 * 60 };
const PUSH_LIMIT = { name: 'push:subscribe', limit: 20, windowSeconds: 60 * 60 };

/** How a seller or buyer receives notifications outside the site. */
@Controller()
export class NotificationAccountController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TELEGRAM_API) private readonly telegram: TelegramApi,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
    private readonly tokens: OneTimeTokens,
    private readonly sessions: CustomerSessionService,
    private readonly rateLimiter: RateLimiterService,
    private readonly audit: AuditService,
  ) {}

  @Get('seller/telegram')
  async telegramStatus(@CurrentAuth() auth: AuthContext) {
    const [user] = await this.db
      .select({ telegram: users.telegramUserId })
      .from(users)
      .where(eq(users.id, auth.user.id));
    return { available: this.telegram.enabled, linked: user?.telegram != null };
  }

  /** A t.me link with a one-time token; opening it in Telegram links the account. */
  @Post('seller/telegram/link')
  @HttpCode(200)
  async telegramLink(@CurrentAuth() auth: AuthContext): Promise<{ url: string }> {
    if (!this.telegram.enabled || !this.telegram.username)
      throw new ValidationFailedException([{ path: 'telegram', message: 'telegram.unavailable' }]);
    await this.rateLimiter.consume(LINK_LIMIT, auth.user.id);
    const token = await this.tokens.issue('telegram-link', auth.user.id);
    return { url: `https://t.me/${this.telegram.username}?start=${token}` };
  }

  @Delete('seller/telegram')
  @HttpCode(204)
  async telegramUnlink(@CurrentAuth() auth: AuthContext, @Req() request: FastifyRequest) {
    await this.db.update(users).set({ telegramUserId: null }).where(eq(users.id, auth.user.id));
    await this.audit.record(
      {
        action: 'telegram.unlinked',
        actorType: 'USER',
        actorId: auth.user.id,
        entityType: 'user',
        entityId: auth.user.id,
      },
      request,
    );
  }

  /** The bot's name, for "forgot password" and "connect Telegram" links; null when switched off. */
  @Public()
  @Get('telegram/bot')
  telegramBot(): { username: string | null } {
    return { username: this.telegram.enabled ? this.telegram.username : null };
  }

  @Public()
  @Get('push/config')
  pushConfig() {
    return pushConfigSchema.parse({ publicKey: this.push.publicKey });
  }

  /** Browser notifications for the signed-in seller, or else for this device's buyer. */
  @Public()
  @Post('push/subscriptions')
  @HttpCode(204)
  async subscribe(
    @Body(new ZodValidationPipe(pushSubscriptionRequestSchema))
    body: z.output<typeof pushSubscriptionRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    if (!this.push.publicKey)
      throw new ValidationFailedException([{ path: 'endpoint', message: 'push.unavailable' }]);
    if (!isPushServiceEndpoint(body.endpoint))
      throw new ValidationFailedException([{ path: 'endpoint', message: 'push.endpoint' }]);
    await this.rateLimiter.consume(PUSH_LIMIT, request.ip);
    const owner = await this.owner(request, reply);
    const values = {
      ...owner,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    };
    await this.db
      .insert(pushSubscriptions)
      .values(values)
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values });
  }

  @Public()
  @Delete('push/subscriptions')
  @HttpCode(204)
  async unsubscribe(
    @Body(new ZodValidationPipe(pushUnsubscribeRequestSchema))
    body: z.output<typeof pushUnsubscribeRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const owner = await this.owner(request, reply);
    await this.db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, body.endpoint),
          eq(pushSubscriptions.ownerType, owner.ownerType),
          eq(pushSubscriptions.ownerId, owner.ownerId),
        ),
      );
  }

  private async owner(request: FastifyRequest, reply: FastifyReply) {
    if (request.auth) return { ownerType: 'USER' as const, ownerId: request.auth.user.id };
    const customer = await this.sessions.getOrCreate(request, reply);
    return { ownerType: 'CUSTOMER' as const, ownerId: customer.id };
  }
}
