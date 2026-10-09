export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'HIDDEN' | 'FLAGGED' | 'REMOVED' | 'ARCHIVED';
export type ProductAction = 'publish' | 'hide' | 'archive' | 'remove' | 'restore' | 'clearFlag';

/** Statuses buyers can see. FLAGGED stays visible: the flag only asks an admin to take a look. */
export const PUBLIC_PRODUCT_STATUSES: readonly ProductStatus[] = ['ACTIVE', 'FLAGGED'];

export function isPublicStatus(status: ProductStatus): boolean {
  return PUBLIC_PRODUCT_STATUSES.includes(status);
}

const RULES: Record<ProductAction, { by: 'seller' | 'admin'; from: readonly ProductStatus[] }> = {
  // Publishing goes to ACTIVE or FLAGGED, decided by the price checks.
  publish: { by: 'seller', from: ['DRAFT', 'HIDDEN'] },
  hide: { by: 'seller', from: ['ACTIVE', 'FLAGGED'] },
  archive: { by: 'seller', from: ['DRAFT', 'ACTIVE', 'HIDDEN', 'FLAGGED', 'REMOVED'] },
  // A removed product comes back only through an admin, as hidden; the seller then republishes it.
  remove: { by: 'admin', from: ['DRAFT', 'ACTIVE', 'HIDDEN', 'FLAGGED'] },
  restore: { by: 'admin', from: ['REMOVED'] },
  clearFlag: { by: 'admin', from: ['FLAGGED'] },
};

export class ProductTransitionError extends Error {
  constructor(
    readonly action: ProductAction,
    readonly from: ProductStatus,
  ) {
    super(`Cannot ${action} a product in status ${from}`);
    this.name = 'ProductTransitionError';
  }
}

export function productActionAllowedFrom(action: ProductAction): readonly ProductStatus[] {
  return RULES[action].from;
}

export function nextProductStatus(
  action: ProductAction,
  from: ProductStatus,
  flagged = false,
): ProductStatus {
  if (!RULES[action].from.includes(from)) throw new ProductTransitionError(action, from);
  switch (action) {
    case 'publish':
      return flagged ? 'FLAGGED' : 'ACTIVE';
    case 'hide':
    case 'restore':
      return 'HIDDEN';
    case 'archive':
      return 'ARCHIVED';
    case 'remove':
      return 'REMOVED';
    case 'clearFlag':
      return 'ACTIVE';
  }
}

/** Sellers may edit anything except products removed by an admin or archived. */
export function sellerCanEdit(status: ProductStatus): boolean {
  return status !== 'REMOVED' && status !== 'ARCHIVED';
}
