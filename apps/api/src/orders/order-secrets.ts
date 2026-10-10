import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { createChallenge, randomInt } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { verify } from 'altcha-lib/frameworks/shared';
import type { Redis } from 'ioredis';
import { API_ENV, type ApiEnv } from '../config/api-env';
import { REDIS } from '../infrastructure/infrastructure.module';

/**
 * Proof-of-work: PBKDF2 with 1000 iterations per attempt and 2000–4000 attempts takes
 * about half a second on a laptop and 1–2 s on a phone; a bot pays that for every order.
 */
const ALTCHA_COST = 1_000;
const ALTCHA_ATTEMPTS = { min: 2_000, max: 4_000 };
const CHALLENGE_TTL_SECONDS = 10 * 60;

/**
 * Secrets of the checkout, all derived from SECRETS_ENCRYPTION_KEY with HKDF so each purpose
 * has its own key: ALTCHA signatures, pickup codes.
 */
@Injectable()
export class OrderSecrets {
  private readonly altchaSignature: string;
  private readonly altchaKeySignature: string;
  private readonly pickupKey: Buffer;

  constructor(
    @Inject(API_ENV) env: ApiEnv,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    const master = Buffer.from(env.SECRETS_ENCRYPTION_KEY, 'base64');
    const derive = (info: string) =>
      Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), info, 32));
    this.altchaSignature = derive('lastsize/altcha-signature').toString('hex');
    this.altchaKeySignature = derive('lastsize/altcha-key-signature').toString('hex');
    this.pickupKey = derive('lastsize/pickup-code');
  }

  async altchaChallenge() {
    return createChallenge({
      algorithm: 'PBKDF2/SHA-256',
      cost: ALTCHA_COST,
      counter: randomInt(ALTCHA_ATTEMPTS.max, ALTCHA_ATTEMPTS.min),
      deriveKey,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000),
      hmacSignatureSecret: this.altchaSignature,
      hmacKeySignatureSecret: this.altchaKeySignature,
    });
  }

  /** True once per solved challenge: a replayed payload is refused. */
  async verifyAltcha(payload: string): Promise<boolean> {
    const result = await verify(payload, deriveKey, this.altchaSignature, this.altchaKeySignature);
    if (result.error || !result.verification?.verified) return false;
    const solved = result.payload as { challenge?: { parameters?: { nonce?: string } } } | null;
    const nonce = solved?.challenge?.parameters?.nonce;
    if (!nonce) return false;
    const fresh = await this.redis.set(
      `altcha:${createHash('sha256').update(nonce).digest('hex')}`,
      '1',
      'EX',
      CHALLENGE_TTL_SECONDS,
      'NX',
    );
    return fresh === 'OK';
  }

  /**
   * The 4-digit code a buyer says at the counter. Computed from the seller-order id, so
   * nothing is stored and it cannot be read from the database.
   */
  pickupCode(sellerOrderId: string): string {
    const digest = createHmac('sha256', this.pickupKey).update(sellerOrderId).digest();
    return String(digest.readUInt32BE(0) % 10_000).padStart(4, '0');
  }

  /** Random token for the order link; only its hash is stored. */
  newAccessToken(): { token: string; hash: string } {
    const token = randomBytes(24).toString('base64url');
    return { token, hash: hashAccessToken(token) };
  }
}

export function hashAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function accessTokenMatches(token: string, storedHash: string): boolean {
  const given = Buffer.from(hashAccessToken(token), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return given.length === stored.length && timingSafeEqual(given, stored);
}
