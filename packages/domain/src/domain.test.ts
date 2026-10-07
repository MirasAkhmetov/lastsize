import { describe, expect, it } from 'vitest';
import { slugify, uniqueSlug } from './slug.js';
import { allowedFrom, canSell, nextStoreStatus, StoreTransitionError } from './store-status.js';

describe('store status', () => {
  it('lets an admin verify or reject only stores under review', () => {
    expect(nextStoreStatus('verify', 'PENDING_VERIFICATION')).toBe('VERIFIED');
    expect(nextStoreStatus('reject', 'PENDING_VERIFICATION')).toBe('REJECTED');
    expect(() => nextStoreStatus('verify', 'BLOCKED')).toThrow(StoreTransitionError);
    expect(() => nextStoreStatus('verify', 'REJECTED')).toThrow(StoreTransitionError);
    expect(() => nextStoreStatus('reject', 'VERIFIED')).toThrow(StoreTransitionError);
  });

  it('returns an unblocked store to its previous standing', () => {
    expect(nextStoreStatus('unblock', 'BLOCKED', { wasVerified: true })).toBe('VERIFIED');
    expect(nextStoreStatus('unblock', 'BLOCKED', { wasVerified: false })).toBe(
      'PENDING_VERIFICATION',
    );
    expect(() => nextStoreStatus('unblock', 'VERIFIED')).toThrow(StoreTransitionError);
  });

  it('sends a store back to review when the seller fixes or changes legal data', () => {
    expect(nextStoreStatus('resubmit', 'REJECTED')).toBe('PENDING_VERIFICATION');
    expect(nextStoreStatus('legalDataChanged', 'VERIFIED')).toBe('PENDING_VERIFICATION');
    expect(() => nextStoreStatus('resubmit', 'BLOCKED')).toThrow(StoreTransitionError);
  });

  it('can block a store in any status except blocked', () => {
    expect(allowedFrom('block')).toEqual(['PENDING_VERIFICATION', 'VERIFIED', 'REJECTED']);
  });

  it('lets only verified stores sell', () => {
    expect(canSell('VERIFIED')).toBe(true);
    expect(canSell('PENDING_VERIFICATION')).toBe(false);
    expect(canSell('BLOCKED')).toBe(false);
  });
});

describe('slugify', () => {
  it.each([
    ['Sneakerhead', 'sneakerhead'],
    ['Nora Showroom', 'nora-showroom'],
    ['Модный Дом', 'modnyy-dom'],
    ['Қызыл Әлем', 'kyzyl-alem'],
    ['Шоурум «Ұлы Дала» №1', 'shourum-uly-dala-1'],
    ['H&M Outlet', 'h-and-m-outlet'],
    ['Café Été', 'cafe-ete'],
    ['   ---   ', 'store'],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('keeps slugs within 60 characters without a trailing dash', () => {
    const slug = slugify('очень длинное название магазина '.repeat(5));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('adds a numeric suffix when the slug is taken', async () => {
    const taken = new Set(['nora', 'nora-2']);
    expect(await uniqueSlug('Nora', async (slug) => taken.has(slug))).toBe('nora-3');
  });
});
