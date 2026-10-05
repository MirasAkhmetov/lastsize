import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, type Database, eq, gt, isNull, sql, userSessions } from '@lastsize/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { API_ENV, type ApiEnv } from '../config/api-env';
import { DATABASE } from '../infrastructure/infrastructure.module';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Sellers stay signed in for weeks; staff sessions are short. */
export const SESSION_POLICY = {
  regular: { idleMs: 30 * DAY, absoluteMs: 90 * DAY },
  staff: { idleMs: 2 * HOUR, absoluteMs: 8 * HOUR },
} as const;
export type SessionKind = keyof typeof SESSION_POLICY;

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface ActiveSession {
  id: string;
  userId: string;
  mfaVerified: boolean;
  lastSeenAt?: Date;
  absoluteExpiresAt?: Date;
}

@Injectable()
export class SessionService {
  readonly cookieName: string;
  private readonly secure: boolean;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.secure = env.NODE_ENV === 'production';
    // __Host- cookies must be Secure, path=/ and host-only: they cannot be set by subdomains.
    this.cookieName = this.secure ? '__Host-sid' : 'sid';
  }

  async create(
    userId: string,
    kind: SessionKind,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<ActiveSession> {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const policy = SESSION_POLICY[kind];
    const absoluteExpiresAt = new Date(now + policy.absoluteMs);
    const [session] = await this.db
      .insert(userSessions)
      .values({
        tokenHash: hashToken(token),
        userId,
        expiresAt: new Date(Math.min(now + policy.idleMs, absoluteExpiresAt.getTime())),
        absoluteExpiresAt,
        ip: request.ip,
        userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
      })
      .returning({ id: userSessions.id });
    void reply.setCookie(this.cookieName, token, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      path: '/',
      expires: absoluteExpiresAt,
    });
    return { id: session!.id, userId, mfaVerified: false };
  }

  /** Finds a valid, unexpired and unrevoked session for the request cookie. */
  async resolve(request: FastifyRequest): Promise<ActiveSession | null> {
    const token = request.cookies[this.cookieName];
    if (!token || token.length > 128) return null;
    const now = new Date();
    const [session] = await this.db
      .select()
      .from(userSessions)
      .where(
        and(
          eq(userSessions.tokenHash, hashToken(token)),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, now),
          gt(userSessions.absoluteExpiresAt, now),
        ),
      );
    if (!session) return null;
    return {
      id: session.id,
      userId: session.userId,
      mfaVerified: session.mfaVerifiedAt !== null,
      lastSeenAt: session.lastSeenAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
    };
  }

  /** Slides the idle expiry. Writes at most once per few minutes per session. */
  async touch(session: ActiveSession, kind: SessionKind): Promise<void> {
    const now = Date.now();
    if (!session.lastSeenAt || !session.absoluteExpiresAt) return;
    if (now - session.lastSeenAt.getTime() < TOUCH_INTERVAL_MS) return;
    const policy = SESSION_POLICY[kind];
    await this.db
      .update(userSessions)
      .set({
        lastSeenAt: new Date(now),
        expiresAt: new Date(Math.min(now + policy.idleMs, session.absoluteExpiresAt.getTime())),
      })
      .where(eq(userSessions.id, session.id));
  }

  async markMfaVerified(sessionId: string): Promise<void> {
    await this.db
      .update(userSessions)
      .set({ mfaVerifiedAt: sql`now()` })
      .where(eq(userSessions.id, sessionId));
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db
      .update(userSessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(userSessions.id, sessionId), isNull(userSessions.revokedAt)));
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.db
      .update(userSessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)));
  }

  /** Revokes the session of the current cookie, if any (used before login to prevent fixation). */
  async revokeByCookie(request: FastifyRequest): Promise<void> {
    const token = request.cookies[this.cookieName];
    if (!token || token.length > 128) return;
    await this.db
      .update(userSessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(userSessions.tokenHash, hashToken(token)), isNull(userSessions.revokedAt)));
  }

  clearCookie(reply: FastifyReply): void {
    void reply.clearCookie(this.cookieName, {
      path: '/',
      secure: this.secure,
      httpOnly: true,
      sameSite: 'lax',
    });
  }
}
