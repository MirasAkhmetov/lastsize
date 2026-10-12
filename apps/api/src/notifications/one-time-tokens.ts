import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../infrastructure/infrastructure.module';

type Purpose = 'telegram-link' | 'password-reset';
const TTL_SECONDS: Record<Purpose, number> = {
  'telegram-link': 15 * 60,
  'password-reset': 30 * 60,
};

/** Single-use tokens in Redis; only their hashes are stored, and reading one deletes it. */
@Injectable()
export class OneTimeTokens {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async issue(purpose: Purpose, userId: string): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    await this.redis.set(this.key(purpose, token), userId, 'EX', TTL_SECONDS[purpose]);
    return token;
  }

  async consume(purpose: Purpose, token: string): Promise<string | null> {
    return this.redis.getdel(this.key(purpose, token));
  }

  private key(purpose: Purpose, token: string): string {
    return `ott:${purpose}:${createHash('sha256').update(token).digest('hex')}`;
  }
}
