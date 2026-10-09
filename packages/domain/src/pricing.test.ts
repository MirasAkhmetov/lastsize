import { describe, expect, it } from 'vitest';
import { discountPercent, flagReasons, priceProblems } from './pricing.js';

const tenge = (value: number) => value * 100;

describe('discountPercent', () => {
  it('rounds down', () => {
    expect(discountPercent({ originalPrice: tenge(59_990), salePrice: tenge(39_990) })).toBe(33);
  });

  it('measures from the lowest of declared, 30-day and marketplace prices', () => {
    const declaredOnly = { originalPrice: tenge(100_000), salePrice: tenge(40_000) };
    expect(discountPercent(declaredOnly)).toBe(60);
    expect(discountPercent({ ...declaredOnly, referencePrice: tenge(50_000) })).toBe(20);
    expect(discountPercent({ ...declaredOnly, externalPrice: tenge(60_000) })).toBe(33);
  });

  it('is zero when there is no real discount', () => {
    expect(discountPercent({ originalPrice: tenge(10_000), salePrice: tenge(10_000) })).toBe(0);
    expect(
      discountPercent({
        originalPrice: tenge(10_000),
        salePrice: tenge(9_000),
        referencePrice: tenge(8_000),
      }),
    ).toBe(0);
  });
});

describe('priceProblems', () => {
  it('requires 30% to publish but lets a draft be saved', () => {
    const prices = { originalPrice: tenge(50_000), salePrice: tenge(40_000) };
    expect(priceProblems(prices, 30, 'publish')).toEqual(['discount.tooSmall']);
    expect(priceProblems(prices, 30, 'draft')).toEqual([]);
    expect(
      priceProblems({ originalPrice: tenge(50_000), salePrice: tenge(35_000) }, 30, 'publish'),
    ).toEqual([]);
  });

  it('rejects impossible prices even in drafts', () => {
    expect(
      priceProblems({ originalPrice: tenge(100), salePrice: tenge(200) }, 30, 'draft'),
    ).toEqual(['price.saleAboveOriginal']);
    expect(priceProblems({ originalPrice: tenge(100), salePrice: 0 }, 30, 'draft')).toEqual([
      'price.salePositive',
    ]);
    expect(priceProblems({ originalPrice: 10_050, salePrice: 5_000 }, 30, 'draft')).toEqual([
      'price.notWholeTenge',
    ]);
  });
});

describe('flagReasons', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const oldStore = new Date('2026-01-01T00:00:00Z');

  it('flags a declared price raised by more than 10%', () => {
    const prices = { originalPrice: tenge(56_000), salePrice: tenge(30_000) };
    expect(
      flagReasons({ previousOriginalPrice: tenge(50_000), prices, storeVerifiedAt: oldStore, now }),
    ).toEqual(['price.originalRaised']);
    expect(
      flagReasons({ previousOriginalPrice: tenge(52_000), prices, storeVerifiedAt: oldStore, now }),
    ).toEqual([]);
  });

  it('flags 80%+ discounts from stores verified less than 30 days ago', () => {
    const prices = { originalPrice: tenge(100_000), salePrice: tenge(19_000) };
    expect(
      flagReasons({
        previousOriginalPrice: null,
        prices,
        storeVerifiedAt: new Date('2026-10-01T00:00:00Z'),
        now,
      }),
    ).toEqual(['discount.suspiciousForNewStore']);
    expect(
      flagReasons({ previousOriginalPrice: null, prices, storeVerifiedAt: oldStore, now }),
    ).toEqual([]);
  });
});
