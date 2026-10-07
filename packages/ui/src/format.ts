export type UiLocale = 'ru' | 'kk';

/**
 * Formats an amount in tiyn as tenge: 3_999_000 → "39 990 ₸".
 * Thousands are separated by a narrow no-break space so the number never wraps.
 */
export function formatPrice(tiyn: number): string {
  const tenge = tiyn / 100;
  const hasFraction = !Number.isInteger(tenge);
  const formatted = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(tenge);
  return `${formatted}\u00a0₸`;
}

/** "−33%" with a real minus sign (U+2212). */
export function formatDiscount(percent: number): string {
  return `\u2212${Math.floor(percent)}%`;
}
