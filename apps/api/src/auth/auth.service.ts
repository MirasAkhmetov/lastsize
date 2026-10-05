import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { MeResponse, MfaSetupResponse } from '@lastsize/contracts';
import { type Database, eq, users } from '@lastsize/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { AuditService } from '../audit/audit.service';
import { DATABASE, REDIS } from '../infrastructure/infrastructure.module';
import { RateLimiterService, type RateLimitRule } from '../security/rate-limiter.service';
import { SECRET_BOX } from '../security/security.module';
import type { SecretBox } from '../security/secret-box';
import { AccessService } from './access.service';
import type { AuthContext } from './auth.types';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';

export const AUTH_RATE_LIMITS = {
  loginPerIp: { name: 'login:ip', limit: 30, windowSeconds: 15 * 60 },
  loginFailuresPerPhone: { name: 'login:phone', limit: 5, windowSeconds: 15 * 60 },
  registerPerIp: { name: 'register:ip', limit: 5, windowSeconds: 60 * 60 },
  mfaFailuresPerUser: { name: 'mfa:user', limit: 5, windowSeconds: 15 * 60 },
} satisfies Record<string, RateLimitRule>;

const INVALID_CREDENTIALS = 'Неверный номер телефона или пароль';
const PENDING_TOTP_TTL_SECONDS = 10 * 60;

const totpContext = (userId: string) => `totp:${userId}`;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SECRET_BOX) private readonly secretBox: SecretBox,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly totp: TotpService,
    private readonly rateLimiter: RateLimiterService,
    private readonly audit: AuditService,
  ) {}

  async register(
    input: { phone: string; name: string; password: string },
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<MeResponse> {
    await this.rateLimiter.consume(AUTH_RATE_LIMITS.registerPerIp, request.ip);
    const passwordHash = await this.passwords.hash(input.password);
    const [user] = await this.db
      .insert(users)
      .values({ phone: input.phone, name: input.name, passwordHash })
      .onConflictDoNothing()
      .returning({ id: users.id });
    if (!user)
      throw new ConflictException(
        'Этот номер уже зарегистрирован. Войдите или восстановите пароль.',
      );

    await this.audit.record(
      { action: 'auth.register', actorType: 'USER', actorId: user.id },
      request,
    );
    await this.sessions.revokeByCookie(request);
    const session = await this.sessions.create(user.id, 'regular', request, reply);
    return this.me((await this.access.load(session))!.context);
  }

  async login(
    input: { phone: string; password: string },
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<MeResponse> {
    await this.rateLimiter.consume(AUTH_RATE_LIMITS.loginPerIp, request.ip);
    await this.rateLimiter.assertNotLimited(AUTH_RATE_LIMITS.loginFailuresPerPhone, input.phone);

    const [user] = await this.db
      .select({ id: users.id, passwordHash: users.passwordHash, status: users.status })
      .from(users)
      .where(eq(users.phone, input.phone));
    const valid = await this.passwords.verify(user?.passwordHash ?? null, input.password);

    if (!user || !valid) {
      const state = await this.rateLimiter.hit(AUTH_RATE_LIMITS.loginFailuresPerPhone, input.phone);
      await this.audit.record(
        {
          action: state.remaining === 0 ? 'auth.login.locked' : 'auth.login.failed',
          actorType: user ? 'USER' : 'ANONYMOUS',
          actorId: user?.id ?? null,
          metadata: { attempt: state.count },
        },
        request,
      );
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (user.status === 'BLOCKED') {
      await this.audit.record(
        { action: 'auth.login.blocked', actorType: 'USER', actorId: user.id },
        request,
      );
      throw new ForbiddenException('Аккаунт заблокирован. Обратитесь в поддержку.');
    }

    await this.rateLimiter.reset(AUTH_RATE_LIMITS.loginFailuresPerPhone, input.phone);
    // A fresh token on every login prevents session fixation.
    await this.sessions.revokeByCookie(request);
    const pending = await this.access.load({ id: '', userId: user.id, mfaVerified: false });
    const session = await this.sessions.create(user.id, pending!.sessionKind, request, reply);
    await this.audit.record(
      { action: 'auth.login.success', actorType: 'USER', actorId: user.id },
      request,
    );
    return this.me((await this.access.load(session))!.context);
  }

  async logout(auth: AuthContext, request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await this.sessions.revoke(auth.sessionId);
    this.sessions.clearCookie(reply);
    await this.audit.record(
      { action: 'auth.logout', actorType: 'USER', actorId: auth.user.id },
      request,
    );
  }

  /** Starts TOTP enrolment for a staff account that has none yet. */
  async startMfaSetup(auth: AuthContext): Promise<MfaSetupResponse> {
    if (!auth.permissions.has('admin:access'))
      throw new ForbiddenException('Двухфакторная защита нужна только сотрудникам');
    if (auth.mfaEnrolled) throw new ConflictException('Двухфакторная защита уже подключена');
    const secret = this.totp.generateSecret();
    await this.redisReady();
    await this.redis.set(
      `totp:pending:${auth.sessionId}`,
      this.secretBox.encrypt(secret, `totp-pending:${auth.sessionId}`),
      'EX',
      PENDING_TOTP_TTL_SECONDS,
    );
    return { secret, otpauthUri: this.totp.otpauthUri(secret, auth.user.phone) };
  }

  async activateMfa(auth: AuthContext, code: string, request: FastifyRequest): Promise<MeResponse> {
    await this.rateLimiter.assertNotLimited(AUTH_RATE_LIMITS.mfaFailuresPerUser, auth.user.id);
    await this.redisReady();
    const sealed = await this.redis.get(`totp:pending:${auth.sessionId}`);
    if (!sealed) throw new ConflictException('Начните подключение заново: код для QR устарел');
    const secret = this.secretBox.decrypt(sealed, `totp-pending:${auth.sessionId}`);

    if (!(await this.totp.verify(auth.user.id, secret, code))) {
      await this.failMfa(auth, request, 'auth.mfa.enroll_failed');
    }
    await this.db
      .update(users)
      .set({ totpSecretEncrypted: this.secretBox.encrypt(secret, totpContext(auth.user.id)) })
      .where(eq(users.id, auth.user.id));
    await this.redis.del(`totp:pending:${auth.sessionId}`);
    await this.sessions.markMfaVerified(auth.sessionId);
    await this.audit.record(
      { action: 'auth.mfa.enrolled', actorType: 'USER', actorId: auth.user.id },
      request,
    );
    return this.reload(auth);
  }

  async verifyMfa(auth: AuthContext, code: string, request: FastifyRequest): Promise<MeResponse> {
    await this.rateLimiter.assertNotLimited(AUTH_RATE_LIMITS.mfaFailuresPerUser, auth.user.id);
    const [user] = await this.db
      .select({ sealed: users.totpSecretEncrypted })
      .from(users)
      .where(eq(users.id, auth.user.id));
    if (!user?.sealed) throw new ConflictException('Сначала подключите двухфакторную защиту');
    const secret = this.secretBox.decrypt(user.sealed, totpContext(auth.user.id));

    if (!(await this.totp.verify(auth.user.id, secret, code))) {
      await this.failMfa(auth, request, 'auth.mfa.failed');
    }
    await this.rateLimiter.reset(AUTH_RATE_LIMITS.mfaFailuresPerUser, auth.user.id);
    await this.sessions.markMfaVerified(auth.sessionId);
    await this.audit.record(
      { action: 'auth.mfa.verified', actorType: 'USER', actorId: auth.user.id },
      request,
    );
    return this.reload(auth);
  }

  me(auth: AuthContext): MeResponse {
    const staff = auth.permissions.has('admin:access');
    return {
      user: auth.user,
      roles: [...auth.roles].sort(),
      permissions: [...auth.permissions].sort(),
      stores: [...auth.stores.values()].map((store) => ({
        storeId: store.storeId,
        storeName: store.storeName,
        storeSlug: store.storeSlug,
        role: store.role,
        permissions: [...store.permissions].sort(),
      })),
      mfa: { required: staff, enrolled: auth.mfaEnrolled, verified: auth.mfaVerified },
    };
  }

  private async reload(auth: AuthContext): Promise<MeResponse> {
    const loaded = await this.access.load({
      id: auth.sessionId,
      userId: auth.user.id,
      mfaVerified: true,
    });
    return this.me(loaded!.context);
  }

  private async failMfa(
    auth: AuthContext,
    request: FastifyRequest,
    action: string,
  ): Promise<never> {
    await this.rateLimiter.hit(AUTH_RATE_LIMITS.mfaFailuresPerUser, auth.user.id);
    await this.audit.record({ action, actorType: 'USER', actorId: auth.user.id }, request);
    throw new UnauthorizedException(
      'Неверный код. Проверьте время на телефоне и попробуйте ещё раз.',
    );
  }

  private async redisReady(): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
  }
}
