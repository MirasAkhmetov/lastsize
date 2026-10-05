import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { customers, type Database, eq, sql } from '@lastsize/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { hashToken } from '../auth/session.service';
import { API_ENV, type ApiEnv } from '../config/api-env';
import { DATABASE } from '../infrastructure/infrastructure.module';
import { RateLimiterService } from '../security/rate-limiter.service';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
const GUEST_CREATION_LIMIT = { name: 'guest:ip', limit: 30, windowSeconds: 60 * 60 };

type CustomerRow = typeof customers.$inferSelect;

/**
 * Guest buyers: no registration, no SMS. A random device token in an HttpOnly cookie
 * identifies the cart, favourites and orders of this browser. Only its hash is stored.
 */
@Injectable()
export class CustomerSessionService {
  readonly cookieName: string;
  private readonly secure: boolean;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(API_ENV) env: ApiEnv,
    private readonly rateLimiter: RateLimiterService,
  ) {
    this.secure = env.NODE_ENV === 'production';
    this.cookieName = this.secure ? '__Host-gsid' : 'gsid';
  }

  async resolve(request: FastifyRequest): Promise<CustomerRow | null> {
    const token = request.cookies[this.cookieName];
    if (!token || token.length > 128) return null;
    const [customer] = await this.db
      .select()
      .from(customers)
      .where(eq(customers.deviceTokenHash, hashToken(token)));
    return customer ?? null;
  }

  /** Returns the guest of this browser, creating one on the first state-changing action. */
  async getOrCreate(request: FastifyRequest, reply: FastifyReply): Promise<CustomerRow> {
    const existing = await this.resolve(request);
    if (existing) {
      await this.db
        .update(customers)
        .set({ lastSeenAt: sql`now()` })
        .where(eq(customers.id, existing.id));
      return existing;
    }
    await this.rateLimiter.consume(GUEST_CREATION_LIMIT, request.ip);
    const token = randomBytes(32).toString('base64url');
    const [created] = await this.db
      .insert(customers)
      .values({ deviceTokenHash: hashToken(token) })
      .returning();
    void reply.setCookie(this.cookieName, token, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      path: '/',
      maxAge: ONE_YEAR_SECONDS,
    });
    return created!;
  }
}
