import { describe, expect, it } from 'vitest';
import { formatDiscount, formatPrice } from './format';

const normalize = (value: string) => value.replace(/[\u00a0\u202f]/g, ' ');

describe('formatPrice', () => {
  it('formats tiyn as tenge with grouped thousands', () => {
    expect(normalize(formatPrice(3_999_000))).toBe('39 990 ₸');
    expect(normalize(formatPrice(129_000_000))).toBe('1 290 000 ₸');
    expect(normalize(formatPrice(9_900))).toBe('99 ₸');
  });

  it('keeps tiyn when the amount is not whole', () => {
    expect(normalize(formatPrice(150))).toBe('1,50 ₸');
  });

  it('never breaks the number across lines', () => {
    expect(formatPrice(3_999_000)).not.toMatch(/ /);
  });
});

describe('formatDiscount', () => {
  it('uses a real minus and rounds down so a discount is never overstated', () => {
    expect(formatDiscount(33.9)).toBe('\u221233%');
  });
});
