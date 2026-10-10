'use client';

import { ApiError, apiRequest, NetworkError, type OrderDetail } from '@lastsize/contracts';
import {
  Button,
  DiscountBadge,
  formatPrice,
  Notice,
  Pill,
  type PillTone,
  ProductImage,
  useToast,
} from '@lastsize/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';

const PART_TONES: Record<OrderDetail['parts'][number]['status'], PillTone> = {
  NEW: 'warn',
  CONFIRMED: 'info',
  READY_FOR_PICKUP: 'ok',
  COURIER_REQUESTED: 'info',
  HANDED_TO_COURIER: 'info',
  COMPLETED: 'ok',
  CANCELLED: 'muted',
};

/** A buyer's order, one block per store; each store confirms and hands over its part. */
export function OrderView({ initial, token }: { initial: OrderDetail; token?: string }) {
  const t = useTranslations('orders');
  const errors = useTranslations('errors');
  const format = useFormatter();
  const toast = useToast();
  const [order, setOrder] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cancel(partId: string) {
    if (!window.confirm(t('cancelConfirm'))) return;
    setPending(partId);
    setError(null);
    try {
      const query = token ? `?t=${encodeURIComponent(token)}` : '';
      setOrder(
        await apiRequest<OrderDetail>(
          'POST',
          `/orders/${order.number}/parts/${partId}/cancel${query}`,
        ),
      );
      toast({ title: t('cancelled') });
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? (cause.problem?.detail ?? errors('generic'))
          : cause instanceof NetworkError
            ? errors('network')
            : errors('generic'),
      );
    } finally {
      setPending(null);
    }
  }

  const time = (iso: string) =>
    format.dateTime(new Date(iso), {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {t('number', { number: order.number })}
          </h1>
          <p className="text-[13px] text-muted">{t('from', { date: time(order.createdAt) })}</p>
        </div>
        <Pill
          tone={
            order.status === 'CANCELLED' ? 'muted' : order.status === 'COMPLETED' ? 'ok' : 'warn'
          }
        >
          {t(`statuses.${order.status}`)}
        </Pill>
      </div>
      {error && <Notice>{error}</Notice>}

      {order.parts.map((part) => (
        <section key={part.id} className="grid gap-3 rounded-2xl border border-line bg-surface p-4">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <Link href={`/store/${part.store.slug}`} className="font-bold hover:underline">
              {part.store.name}
            </Link>
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] text-muted">
                {part.fulfillment === 'PICKUP' ? t('pickup') : t('delivery')}
              </span>
              <Pill tone={PART_TONES[part.status]}>{t(`partStatuses.${part.status}`)}</Pill>
            </div>
          </header>

          {part.pickupCode && (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-soft px-4 py-3">
              <div>
                <p className="text-[12.5px] font-semibold">{t('pickupCode')}</p>
                <p className="text-[12px] text-muted">{t('pickupCodeHint')}</p>
              </div>
              <p className="font-display text-3xl font-bold tracking-[0.2em] tabular-nums">
                {part.pickupCode}
              </p>
            </div>
          )}
          {part.confirmBy && (
            <p className="text-[13px] text-muted">
              {t('callNote', { phone: order.contactPhone })}{' '}
              {t('confirmBy', { time: time(part.confirmBy) })}
            </p>
          )}
          {part.cancelReason && (
            <Notice tone="info">
              {t.has(`cancelReasons.${part.cancelReason}`)
                ? t(`cancelReasons.${part.cancelReason}`)
                : part.cancelReason}
            </Notice>
          )}

          <ul className="grid gap-3">
            {part.items.map((item, index) => (
              <li key={index} className="grid grid-cols-[56px_1fr_auto] gap-3 text-[13.5px]">
                <Link
                  href={`/product/${item.productPath}`}
                  className="aspect-[3/4] overflow-hidden rounded-img bg-photo-1"
                >
                  {item.image && <ProductImage url={item.image.url} alt="" sizes="56px" />}
                </Link>
                <div>
                  {item.brand && <p className="font-bold">{item.brand}</p>}
                  <p className="text-muted">{item.title}</p>
                  <p className="tabular-nums">
                    {item.size ? `EU ${item.size} · ` : ''}× {item.quantity}
                  </p>
                </div>
                <div className="grid content-start justify-items-end gap-1 tabular-nums">
                  <span className="font-bold">{formatPrice(item.unitPrice * item.quantity)}</span>
                  {item.originalPrice > item.unitPrice && (
                    <DiscountBadge
                      percent={Math.floor(
                        ((item.originalPrice - item.unitPrice) * 100) / item.originalPrice,
                      )}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>

          <dl className="grid gap-1 border-t border-dashed border-line pt-3 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">
                {part.fulfillment === 'PICKUP' ? t('storeAddress') : t('deliveryAddress')}
              </dt>
              <dd className="text-right">
                {part.fulfillment === 'PICKUP' ? part.store.address : part.deliveryAddress}
              </dd>
            </div>
            {part.courierFee !== null && (
              <div className="flex justify-between">
                <dt className="text-muted">
                  {t('courierFee', { price: formatPrice(part.courierFee) })}
                </dt>
              </div>
            )}
            <div className="flex justify-between font-bold tabular-nums">
              <dt>{t('total')}</dt>
              <dd>{formatPrice(part.itemsTotal)}</dd>
            </div>
          </dl>

          {part.canCancel && (
            <Button
              size="sm"
              variant="ghost"
              className="justify-self-start"
              disabled={pending !== null}
              onClick={() => void cancel(part.id)}
            >
              {t('cancel')}
            </Button>
          )}
        </section>
      ))}
    </div>
  );
}

/** The order link with a copy button; the token is shown only right after checkout. */
export function OrderLink({ number, token }: { number: number; token: string }) {
  const t = useTranslations('orders');
  const toast = useToast();
  const [url, setUrl] = useState('');
  useEffect(() => setUrl(`${window.location.origin}/orders/${number}?t=${token}`), [number, token]);
  return (
    <div className="grid gap-2 rounded-2xl border border-line bg-surface p-4">
      <p className="font-bold">{t('link')}</p>
      <p className="text-[13px] text-muted">{t('linkHint')}</p>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          aria-label={t('link')}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 rounded-ctl border border-line bg-soft px-3 py-2 text-[13px]"
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void navigator.clipboard.writeText(url).then(() => toast({ title: t('copied') }))
          }
        >
          {t('copy')}
        </Button>
      </div>
    </div>
  );
}
