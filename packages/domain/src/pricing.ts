/**
 * Price rules of an honest sale. All amounts are integers in tiyn.
 * The database computes the stored discount with the same formula (product_variants.discount_percent).
 */

export interface VariantPrices {
  originalPrice: number;
  salePrice: number;
  /** Lowest selling price of the last 30 days, if known. */
  referencePrice?: number | null;
  /** Actual selling price on Wildberries or Kaspi, if known. */
  externalPrice?: number | null;
}

/** The price the discount is measured from: the lowest of declared, 30-day and marketplace prices. */
export function basePrice({ originalPrice, referencePrice, externalPrice }: VariantPrices): number {
  return Math.min(originalPrice, referencePrice ?? originalPrice, externalPrice ?? originalPrice);
}

/** Rounded down, so a discount is never overstated. */
export function discountPercent(prices: VariantPrices): number {
  const base = basePrice(prices);
  if (base <= 0 || prices.salePrice >= base) return 0;
  return Math.floor(((base - prices.salePrice) * 100) / base);
}

export type PriceProblem =
  'price.salePositive' | 'price.saleAboveOriginal' | 'price.notWholeTenge' | 'discount.tooSmall';

/** Problems that block saving (`draft`) or publishing (`publish`) a product at these prices. */
export function priceProblems(
  prices: VariantPrices,
  minDiscountPercent: number,
  intent: 'draft' | 'publish',
): PriceProblem[] {
  const problems: PriceProblem[] = [];
  if (prices.salePrice <= 0) problems.push('price.salePositive');
  if (prices.salePrice > prices.originalPrice) problems.push('price.saleAboveOriginal');
  if (prices.salePrice % 100 !== 0 || prices.originalPrice % 100 !== 0)
    problems.push('price.notWholeTenge');
  if (
    intent === 'publish' &&
    problems.length === 0 &&
    discountPercent(prices) < minDiscountPercent
  ) {
    problems.push('discount.tooSmall');
  }
  return problems;
}

export type FlagReason =
  | 'price.originalRaised'
  | 'discount.suspiciousForNewStore'
  /** The marketplace price fell, so the discount measured from it is below the minimum. */
  | 'discount.externalPriceDropped';

const RAISE_TOLERANCE = 0.1;
const SUSPICIOUS_DISCOUNT = 80;
const NEW_STORE_DAYS = 30;

/**
 * Reasons for an admin to look at a product. Flagged products stay visible; the flag only
 * puts them first in the moderation feed.
 */
export function flagReasons(input: {
  previousOriginalPrice: number | null;
  prices: VariantPrices;
  storeVerifiedAt: Date | null;
  now?: Date;
}): FlagReason[] {
  const reasons: FlagReason[] = [];
  const { previousOriginalPrice, prices } = input;
  if (
    previousOriginalPrice !== null &&
    prices.originalPrice > previousOriginalPrice * (1 + RAISE_TOLERANCE)
  ) {
    reasons.push('price.originalRaised');
  }
  const now = input.now ?? new Date();
  const storeAgeDays = input.storeVerifiedAt
    ? (now.getTime() - input.storeVerifiedAt.getTime()) / 86_400_000
    : 0;
  if (discountPercent(prices) >= SUSPICIOUS_DISCOUNT && storeAgeDays < NEW_STORE_DAYS) {
    reasons.push('discount.suspiciousForNewStore');
  }
  return reasons;
}
