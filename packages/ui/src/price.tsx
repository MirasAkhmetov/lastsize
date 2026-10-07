import { cn } from './cn';
import { formatPrice } from './format';

export interface PriceProps {
  salePrice: number;
  originalPrice?: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Accessible label for the old price, e.g. "Цена до скидки". */
  originalLabel?: string;
}

const sizes = { sm: 'text-[13px]', md: 'text-base', lg: 'text-[22px]' } as const;

export function Price({
  salePrice,
  originalPrice,
  size = 'md',
  className,
  originalLabel = 'Цена до скидки',
}: PriceProps) {
  const discounted = originalPrice !== undefined && originalPrice > salePrice;
  return (
    <span
      className={cn(
        'inline-flex flex-wrap items-baseline gap-x-1.5 font-bold tabular-nums',
        sizes[size],
        className,
      )}
    >
      <span className={discounted ? 'text-sale' : 'text-ink'}>{formatPrice(salePrice)}</span>
      {discounted && (
        <s className="text-[0.85em] font-normal text-muted">
          <span className="sr-only">{originalLabel}: </span>
          {formatPrice(originalPrice)}
        </s>
      )}
    </span>
  );
}
