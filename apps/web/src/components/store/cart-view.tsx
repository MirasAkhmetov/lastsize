'use client';

import { ApiError, apiRequest, type Cart, type CartItem, NetworkError } from '@lastsize/contracts';
import {
  buttonClasses,
  cn,
  DiscountBadge,
  EmptyState,
  formatPrice,
  Notice,
  ProductImage,
  Skeleton,
} from '@lastsize/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { announceCartCount } from './cart-count';

/** The cart, grouped by store: each store confirms and hands over its part on its own. */
export function CartView() {
  const t = useTranslations('cart');
  const empty = useTranslations('empty');
  const validation = useTranslations('validation');
  const errors = useTranslations('errors');
  const [cart, setCart] = useState<Cart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<Cart>('GET', '/cart')
      .then(setCart)
      .catch(() => setError(errors('generic')));
  }, [errors]);

  async function change(item: CartItem, quantity: number | null) {
    setPending(item.variantId);
    setError(null);
    try {
      const next =
        quantity === null
          ? await apiRequest<Cart>('DELETE', `/cart/items/${item.variantId}`)
          : await apiRequest<Cart>('PATCH', `/cart/items/${item.variantId}`, { quantity });
      setCart(next);
      announceCartCount(next.itemCount);
    } catch (cause) {
      const code = cause instanceof ApiError ? Object.values(cause.fieldErrors())[0] : undefined;
      setError(
        code && validation.has(code)
          ? validation(code)
          : cause instanceof NetworkError
            ? errors('network')
            : errors('generic'),
      );
    } finally {
      setPending(null);
    }
  }

  if (!cart) {
    return (
      <div className="grid gap-3 py-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (cart.stores.length === 0) {
    return (
      <div className="py-10">
        <EmptyState
          icon="0"
          title={empty('cartTitle')}
          description={empty('cartText')}
          action={
            <Link href="/catalog" className={buttonClasses('primary', 'sm')}>
              {empty('toSale')}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6 py-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="grid gap-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          {t('title')}{' '}
          <span className="text-base font-normal text-muted">
            · {t('count', { count: cart.itemCount })}
          </span>
        </h1>
        {error && <Notice>{error}</Notice>}
        {cart.stores.map((store) => (
          <section
            key={store.storeId}
            className="grid gap-3 rounded-2xl border border-line bg-surface p-4"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <Link href={`/store/${store.slug}`} className="font-bold hover:underline">
                {store.name}
              </Link>
              <span className="text-[12.5px] text-muted">
                {store.deliveryEnabled ? t('pickupAndDelivery') : t('pickupOnly')} · {store.address}
              </span>
            </header>
            <ul className="grid gap-3">
              {store.items.map((item) => (
                <li
                  key={item.variantId}
                  className={cn(
                    'grid grid-cols-[72px_1fr] gap-3',
                    item.problem === 'unavailable' && 'opacity-60',
                  )}
                >
                  <Link
                    href={`/product/${item.productPath}`}
                    className="aspect-[3/4] overflow-hidden rounded-img bg-photo-1"
                  >
                    {item.image && <ProductImage url={item.image.url} alt="" sizes="72px" />}
                  </Link>
                  <div className="grid gap-1.5 text-[13.5px]">
                    <div>
                      {item.brand && <p className="font-bold">{item.brand}</p>}
                      <Link
                        href={`/product/${item.productPath}`}
                        className="text-muted hover:underline"
                      >
                        {item.title}
                      </Link>
                      {item.size && <p className="tabular-nums">EU {item.size}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 tabular-nums">
                      <span className="font-bold">{formatPrice(item.unitPrice)}</span>
                      <span className="text-muted line-through">
                        {formatPrice(item.originalPrice)}
                      </span>
                      {item.discountPercent > 0 && <DiscountBadge percent={item.discountPercent} />}
                    </div>
                    {item.priceChanged && (
                      <p className="text-[12.5px] text-warn">
                        {t('priceChanged', { price: formatPrice(item.previousPrice) })}
                      </p>
                    )}
                    {item.problem && (
                      <p className="text-[12.5px] font-semibold text-sale">
                        {item.problem === 'unavailable'
                          ? t('unavailable')
                          : t('notEnough', { count: item.available })}
                      </p>
                    )}
                    <div className="flex items-center gap-3">
                      {item.problem !== 'unavailable' && (
                        <div className="flex items-center rounded-ctl border border-line">
                          <button
                            type="button"
                            aria-label={t('decrease')}
                            disabled={item.quantity <= 1 || pending !== null}
                            onClick={() => void change(item, item.quantity - 1)}
                            className="px-3 py-1 disabled:opacity-30"
                          >
                            −
                          </button>
                          <span className="min-w-6 text-center tabular-nums">{item.quantity}</span>
                          <button
                            type="button"
                            aria-label={t('increase')}
                            disabled={
                              item.quantity >= Math.min(item.available, 10) || pending !== null
                            }
                            onClick={() => void change(item, item.quantity + 1)}
                            className="px-3 py-1 disabled:opacity-30"
                          >
                            +
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        disabled={pending !== null}
                        onClick={() => void change(item, null)}
                        className="text-[12.5px] text-muted underline underline-offset-4"
                      >
                        {t('remove')}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <aside className="grid gap-3 rounded-2xl border border-line bg-surface p-4 lg:sticky lg:top-28">
        <div className="flex justify-between text-[15px] font-bold tabular-nums">
          <span>{t('total')}</span>
          <span>{formatPrice(cart.itemsTotal)}</span>
        </div>
        <p className="text-[12.5px] text-muted">{t('deliveryNote')}</p>
        {cart.hasProblems && <Notice>{t('fixProblems')}</Notice>}
        {cart.hasProblems ? (
          <span
            className={cn(buttonClasses('primary', 'md', true), 'pointer-events-none opacity-40')}
          >
            {t('checkout')}
          </span>
        ) : (
          <Link href="/checkout" className={buttonClasses('primary', 'md', true)}>
            {t('checkout')}
          </Link>
        )}
      </aside>
    </div>
  );
}
