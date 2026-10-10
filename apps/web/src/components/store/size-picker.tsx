'use client';

import type { ProductDetail } from '@lastsize/contracts';
import { Button, SizeChip } from '@lastsize/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

/** Size choice with real stock. Ordering opens with the cart (next steps); until then the button explains. */
export function SizePicker({ sizes }: { sizes: ProductDetail['sizes'] }) {
  const t = useTranslations('product');
  const oneSize = sizes.length === 1 && sizes[0]!.label === null;
  const inStock = sizes.filter((size) => size.available > 0);
  const [selected, setSelected] = useState<string | null>(
    oneSize || inStock.length === 1 ? (inStock[0]?.variantId ?? null) : null,
  );
  const chosen = sizes.find((size) => size.variantId === selected);

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
                onClick={() => setSelected(size.variantId)}
              />
            ))}
          </div>
        </div>
      )}
      {chosen && chosen.available <= 2 && (
        <p className="text-[13px] font-semibold text-sale">
          {chosen.available === 1 ? t('lastOne') : t('lastPieces', { count: chosen.available })}
        </p>
      )}
      <Button block disabled aria-describedby="cart-soon">
        {selected || oneSize ? t('addToCart') : t('chooseSize')}
      </Button>
      <p id="cart-soon" className="text-[12.5px] text-muted">
        {t('cartSoon')}
      </p>
    </div>
  );
}
