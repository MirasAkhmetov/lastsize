import { z } from 'zod';

/**
 * Normalises a Kazakhstan mobile number to E.164 (+7XXXXXXXXXX).
 * Accepts "+7 701 123 45 67", "8 (701) 123-45-67", "87011234567", "77011234567".
 * Returns null when the input is not a valid +7 number with a 7xx operator code.
 */
export function normalizeKzPhone(input: string): string | null {
  const digits = input.replace(/[\s()\-.]/g, '');
  const match = /^(?:\+7|8|7)(7\d{9})$/.exec(digits);
  return match ? `+7${match[1]}` : null;
}

export const kzPhoneSchema = z
  .string()
  .max(32)
  .transform((value, context) => {
    const phone = normalizeKzPhone(value);
    if (!phone) {
      context.addIssue({
        code: 'custom',
        message: 'Enter a Kazakhstan mobile number, e.g. +7 701 123 45 67',
      });
      return z.NEVER;
    }
    return phone;
  });
