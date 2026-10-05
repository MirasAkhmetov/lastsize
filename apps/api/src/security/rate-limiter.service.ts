import { createHash } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../infrastructure/infrastructure.module';

export interface RateLimitRule {
  /** Logical name, e.g. "login:phone". */
  name: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitState {
  count: number;
  remaining: number;
  retryAfterSeconds: number;
}

export class RateLimitedException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
  }
}

/**
 * Fixed-window counters in Redis. Identifiers (phone numbers, IPs) are hashed so that
 * personal data does not end up in Redis keys.
 */
@Injectable()
export class RateLimiterService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private key(rule: RateLimitRule, identifier: string): string {
    const digest = createHash('sha256').update(identifier).digest('base64url').slice(0, 22);
    return `rl:${rule.name}:${digest}`;
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
  }

  /** Counts one attempt and throws RateLimitedException when the limit is exceeded. */
  async consume(rule: RateLimitRule, identifier: string): Promise<RateLimitState> {
    const state = await this.hit(rule, identifier);
    if (state.count > rule.limit) throw new RateLimitedException(state.retryAfterSeconds);
    return state;
  }

  /** Counts one attempt without throwing. */
  async hit(rule: RateLimitRule, identifier: string): Promise<RateLimitState> {
    await this.ensureConnected();
    const key = this.key(rule, identifier);
    const result = await this.redis
      .multi()
      .incr(key)
      .expire(key, rule.windowSeconds, 'NX')
      .ttl(key)
      .exec();
    const count = Number(result?.[0]?.[1] ?? 0);
    const ttl = Number(result?.[2]?.[1] ?? rule.windowSeconds);
    return {
      count,
      remaining: Math.max(0, rule.limit - count),
      retryAfterSeconds: ttl > 0 ? ttl : rule.windowSeconds,
    };
  }

  /** Throws if the limit is already exhausted, without counting. */
  async assertNotLimited(rule: RateLimitRule, identifier: string): Promise<void> {
    await this.ensureConnected();
    const key = this.key(rule, identifier);
    const [count, ttl] = await Promise.all([this.redis.get(key), this.redis.ttl(key)]);
    if (Number(count ?? 0) >= rule.limit) {
      throw new RateLimitedException(ttl > 0 ? ttl : rule.windowSeconds);
    }
  }

  async reset(rule: RateLimitRule, identifier: string): Promise<void> {
    await this.ensureConnected();
    await this.redis.del(this.key(rule, identifier));
  }
}
