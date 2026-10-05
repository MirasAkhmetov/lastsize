import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SecretBox } from './secret-box';

const box = new SecretBox(randomBytes(32).toString('base64'));

describe('SecretBox', () => {
  it('round-trips a secret', () => {
    const sealed = box.encrypt('JBSWY3DPEHPK3PXP', 'totp:user-1');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.decrypt(sealed, 'totp:user-1')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('produces a different ciphertext every time', () => {
    expect(box.encrypt('same', 'ctx')).not.toBe(box.encrypt('same', 'ctx'));
  });

  it('refuses a ciphertext moved to another context', () => {
    const sealed = box.encrypt('secret', 'totp:user-1');
    expect(() => box.decrypt(sealed, 'totp:user-2')).toThrow();
  });

  it('detects tampering', () => {
    const sealed = box.encrypt('secret', 'ctx');
    const parts = sealed.split('.');
    const body = Buffer.from(parts[3]!, 'base64url');
    body[0] = body[0]! ^ 1;
    parts[3] = body.toString('base64url');
    expect(() => box.decrypt(parts.join('.'), 'ctx')).toThrow();
  });

  it('refuses a different key', () => {
    const other = new SecretBox(randomBytes(32).toString('base64'));
    expect(() => other.decrypt(box.encrypt('secret', 'ctx'), 'ctx')).toThrow();
  });
});
