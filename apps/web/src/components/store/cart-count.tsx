'use client';

import { apiRequest } from '@lastsize/contracts';
import { cn } from '@lastsize/ui';
import { useEffect, useState } from 'react';

const EVENT = 'lastsize:cart';

/** Tell every badge on the page that the cart has this many items now. */
export function announceCartCount(count: number): void {
  window.dispatchEvent(new CustomEvent<number>(EVENT, { detail: count }));
}

/**
 * Item count of the guest cart. Pages are cached for everyone, so the count is fetched in the
 * browser and updated by `announceCartCount` after each change.
 */
export function useCartCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    apiRequest<{ count: number }>('GET', '/cart/count')
      .then((result) => active && setCount(result.count))
      .catch(() => undefined);
    const listener = (event: Event) => setCount((event as CustomEvent<number>).detail);
    window.addEventListener(EVENT, listener);
    return () => {
      active = false;
      window.removeEventListener(EVENT, listener);
    };
  }, []);
  return count;
}

export function CartBadge({ className }: { className?: string }) {
  const count = useCartCount();
  if (count === 0) return null;
  return (
    <span
      className={cn(
        'min-w-[18px] rounded-full bg-sale px-1 text-center text-[10.5px] leading-[18px] font-bold text-on-sale tabular-nums',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
