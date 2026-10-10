import { describe, expect, it } from 'vitest';
import { catalogQuerySchema, productPath, shortIdFromProductPath } from './storefront.js';

describe('product URLs', () => {
  it('round-trips slug and short id', () => {
    const path = productPath({ slug: 'nike-air-max-270', shortId: 'k7f2q9mx' });
    expect(path).toBe('/product/nike-air-max-270-k7f2q9mx');
    expect(shortIdFromProductPath('nike-air-max-270-k7f2q9mx')).toBe('k7f2q9mx');
    expect(shortIdFromProductPath('k7f2q9mx')).toBe('k7f2q9mx');
    expect(shortIdFromProductPath('nike')).toBeNull();
    expect(shortIdFromProductPath("x' or 1=1")).toBeNull();
  });
});

describe('catalogQuerySchema', () => {
  it('parses filters from the URL', () => {
    expect(
      catalogQuerySchema.parse({
        size: '2021,2022',
        brand: 'nike,adidas',
        discount: '50',
        priceMax: '50000',
        sort: 'price_asc',
      }),
    ).toMatchObject({
      size: ['2021', '2022'],
      brand: ['nike', 'adidas'],
      discount: 50,
      priceMax: 50000,
      sort: 'price_asc',
      page: 1,
    });
  });

  it('rejects malformed values instead of passing them to SQL', () => {
    expect(catalogQuerySchema.safeParse({ brand: "nike'; drop table products;--" }).success).toBe(
      false,
    );
    expect(catalogQuerySchema.safeParse({ discount: '45' }).success).toBe(false);
    expect(catalogQuerySchema.safeParse({ page: '1000' }).success).toBe(false);
  });
});
