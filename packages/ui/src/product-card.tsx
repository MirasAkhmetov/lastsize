import type { ReactNode } from 'react';
import { DiscountBadge } from './badge';
import { cn } from './cn';
import { Price } from './price';

export interface ProductCardSize {
  label: string;
  available: boolean;
}

export interface ProductCardProps {
  href: string;
  brand: string;
  title: string;
  salePrice: number;
  originalPrice: number;
  discountPercent: number;
  sizes: ProductCardSize[];
  storeName: string;
  city: string;
  /** The photo, rendered by the app (e.g. next/image). Falls back to a neutral placeholder. */
  image?: ReactNode;
  /** "Остался 1 размер 40", shown only when real stock is 2 or fewer. */
  scarcityNote?: string;
  /** Size of the buyer, highlighted when available. */
  highlightSize?: string;
  favoriteSlot?: ReactNode;
  className?: string;
}

/**
 * Fixed information order: photo → brand → title → price → sizes in stock → scarcity → store.
 * The store is always shown, so the marketplace nature is clear on every card.
 */
export function ProductCard({
  href,
  brand,
  title,
  salePrice,
  originalPrice,
  discountPercent,
  sizes,
  storeName,
  city,
  image,
  scarcityNote,
  highlightSize,
  favoriteSlot,
  className,
}: ProductCardProps) {
  return (
    <article className={cn('relative grid min-w-0 gap-1 text-[12.5px] leading-snug', className)}>
      <div className="relative aspect-[3/4] overflow-hidden rounded-img bg-photo-1">
        {image}
        <div className="absolute top-1.5 left-1.5">
          <DiscountBadge percent={discountPercent} />
        </div>
        {favoriteSlot && <div className="absolute top-1.5 right-1.5">{favoriteSlot}</div>}
      </div>
      <a href={href} className="font-bold after:absolute after:inset-0 after:content-['']">
        {brand}
        <span className="block truncate font-normal text-muted">{title}</span>
      </a>
      <Price salePrice={salePrice} originalPrice={originalPrice} size="sm" />
      {sizes.length > 0 && (
        <p className="text-[11.5px] tabular-nums">
          {sizes.map((size, index) => (
            <span key={size.label}>
              {index > 0 && ' · '}
              <span
                className={cn(
                  !size.available && 'text-muted line-through',
                  size.available &&
                    size.label === highlightSize &&
                    'font-bold underline underline-offset-2',
                )}
              >
                {size.label}
              </span>
            </span>
          ))}
        </p>
      )}
      {scarcityNote && <p className="text-[11.5px] font-semibold text-sale">{scarcityNote}</p>}
      <p className="truncate text-[11.5px] text-muted">
        {storeName} · {city}
      </p>
    </article>
  );
}
