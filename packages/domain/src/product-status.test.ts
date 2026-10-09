import { describe, expect, it } from 'vitest';
import {
  isPublicStatus,
  nextProductStatus,
  ProductTransitionError,
  sellerCanEdit,
} from './product-status.js';

describe('product status', () => {
  it('publishes drafts and hidden products, flagged when the price checks say so', () => {
    expect(nextProductStatus('publish', 'DRAFT')).toBe('ACTIVE');
    expect(nextProductStatus('publish', 'HIDDEN', true)).toBe('FLAGGED');
    expect(() => nextProductStatus('publish', 'REMOVED')).toThrow(ProductTransitionError);
    expect(() => nextProductStatus('publish', 'ACTIVE')).toThrow(ProductTransitionError);
  });

  it('keeps removed products away from the seller until an admin restores them', () => {
    expect(nextProductStatus('remove', 'ACTIVE')).toBe('REMOVED');
    expect(nextProductStatus('restore', 'REMOVED')).toBe('HIDDEN');
    expect(sellerCanEdit('REMOVED')).toBe(false);
    expect(sellerCanEdit('HIDDEN')).toBe(true);
  });

  it('shows only active and flagged products to buyers', () => {
    expect(isPublicStatus('ACTIVE')).toBe(true);
    expect(isPublicStatus('FLAGGED')).toBe(true);
    expect(isPublicStatus('HIDDEN')).toBe(false);
    expect(isPublicStatus('DRAFT')).toBe(false);
  });

  it('lets an admin clear a flag', () => {
    expect(nextProductStatus('clearFlag', 'FLAGGED')).toBe('ACTIVE');
    expect(() => nextProductStatus('clearFlag', 'ACTIVE')).toThrow(ProductTransitionError);
  });
});
