import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import * as OTPAuth from 'otpauth';
import { REDIS } from '../infrastructure/infrastructure.module';

const PERIOD_SECONDS = 30;

/** TOTP (Google Authenticator) codes for staff accounts. */
@Injectable()
export class TotpService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  generateSecret(): string {
    return new OTPAuth.Secret({ size: 20 }).base32;
  }

  otpauthUri(secret: string, accountLabel: string): string {
    return this.totp(secret, accountLabel).toString();
  }

  /**
   * Checks a code (±1 period for clock drift) and rejects reuse of an accepted code,
   * so an intercepted code cannot be replayed.
   */
  async verify(userId: string, secret: string, code: string): Promise<boolean> {
    const delta = this.totp(secret, 'verify').validate({ token: code, window: 1 });
    if (delta === null) return false;
    const step = Math.floor(Date.now() / 1000 / PERIOD_SECONDS) + delta;
    if (this.redis.status === 'wait') await this.redis.connect();
    const firstUse = await this.redis.set(
      `totp:used:${userId}:${step}`,
      '1',
      'EX',
      PERIOD_SECONDS * 4,
      'NX',
    );
    return firstUse === 'OK';
  }

  private totp(secret: string, label: string): OTPAuth.TOTP {
    return new OTPAuth.TOTP({
      issuer: 'LastSize',
      label,
      algorithm: 'SHA1',
      digits: 6,
      period: PERIOD_SECONDS,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
  }
}
