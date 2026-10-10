'use client';

import {
  ApiError,
  apiRequest,
  type Cart,
  NetworkError,
  type ProductDetail,
} from '@lastsize/contracts';
import { Button, SizeChip, useToast } from '@lastsize/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { announceCartCount } from './cart-count';

/** Size choice with real stock and "add to cart". */
export function SizePicker({ sizes }: { sizes: ProductDetail['sizes'] }) {
  const t = useTranslations('product');
  const tc = useTranslations('cart');
  const validation = useTranslations('validation');
  const errors = useTranslations('errors');
  const toast = useToast();
  const router = useRouter();
  const oneSize = sizes.length === 1 && sizes[0]!.label === null;
  const inStock = sizes.filter((size) => size.available > 0);
  const [selected, setSelected] = useState<string | null>(
    oneSize || inStock.length === 1 ? (inStock[0]?.variantId ?? null) : null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = sizes.find((size) => size.variantId === selected);

  async function add() {
    if (!chosen) return;
    setPending(true);
    setError(null);
    try {
      const cart = await apiRequest<Cart>('POST', '/cart/items', { variantId: chosen.variantId });
      announceCartCount(cart.itemCount);
      toast({
        title: tc('added'),
        action: { label: tc('toCart'), onClick: () => router.push('/cart') },
      });
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
      setPending(false);
    }
  }

  return (
    <div className="grid gap-3">
      {!oneSize && (
        <div className="grid gap-2">
          <p className="text-[13px] font-semibold">{t('sizeEu')}</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('chooseSize')}>
            {sizes.map((size) => (
              <SizeChip
                key={size.variantId}
                label={size.label ?? '—'}
                state={
                  size.available === 0 ? 'unavailable' : size.available === 1 ? 'last' : 'available'
                }
                selected={selected === size.variantId}
                onClick={() => {
                  setSelected(size.variantId);
                  setError(null);
                }}
              />
            ))}
          </div>
        </div>
      )}
      {chosen && chosen.available <= 2 && chosen.available > 0 && (
        <p className="text-[13px] font-semibold text-sale">
          {chosen.available === 1 ? t('lastOne') : t('lastPieces', { count: chosen.available })}
        </p>
      )}
      <Button
        block
        disabled={!chosen || chosen.available === 0 || pending}
        onClick={() => void add()}
      >
        {chosen ? t('addToCart') : t('chooseSize')}
      </Button>
      {error && (
        <p role="alert" className="text-[13px] text-sale">
          {error}
        </p>
      )}
    </div>
  );
}
