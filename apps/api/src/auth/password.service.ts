import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/** OWASP-recommended argon2id parameters: 19 MiB memory, 2 iterations. */
const ARGON2_OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  /** Used for unknown accounts so that response time does not reveal whether a phone exists. */
  private readonly dummyHash: Promise<string> = hash('dummy-password-for-timing', ARGON2_OPTIONS);

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string | null, password: string): Promise<boolean> {
    const target = passwordHash ?? (await this.dummyHash);
    try {
      const valid = await verify(target, password);
      return passwordHash !== null && valid;
    } catch {
      return false;
    }
  }
}
