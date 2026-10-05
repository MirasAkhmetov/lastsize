import { describe, expect, it } from 'vitest';
import { normalizeKzPhone } from './phone.js';

describe('normalizeKzPhone', () => {
  it.each([
    ['+7 701 123 45 67', '+77011234567'],
    ['8 (701) 123-45-67', '+77011234567'],
    ['87011234567', '+77011234567'],
    ['77011234567', '+77011234567'],
    ['+7-747-000-00-00', '+77470000000'],
  ])('normalises %s', (input, expected) => {
    expect(normalizeKzPhone(input)).toBe(expected);
  });

  it.each(['+7 495 123 45 67', '12345', '+1 202 555 0100', '+7701123456', '+770112345678', 'abc'])(
    'rejects %s',
    (input) => {
      expect(normalizeKzPhone(input)).toBeNull();
    },
  );
});
