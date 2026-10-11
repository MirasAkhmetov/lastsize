'use client';

import {
  ApiError,
  apiRequest,
  NetworkError,
  REFUND_METHODS,
  type SellerOrderDetail,
  STORE_CANCEL_REASONS,
  type StoreActionRequest,
} from '@lastsize/contracts';
import {
  Button,
  formatPrice,
  Notice,
  Pill,
  ProductImage,
  SelectField,
  TextField,
  useToast,
} from '@lastsize/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';

function parseTenge(value: string): number | null {
  const digits = value.replace(/[^\d]/g, '');
  return digits ? Number(digits) * 100 : null;
}

/** One order of the store: details, the next step with its button, returns, history. */
export function SellerOrderView({
  storeId,
  initial,
}: {
  storeId: string;
  initial: SellerOrderDetail;
}) {
  const t = useTranslations('sellerOrders');
  const to = useTranslations('orders');
  const validation = useTranslations('validation');
  const errors = useTranslations('errors');
  const format = useFormatter();
  const toast = useToast();
  const router = useRouter();
  const [order, setOrder] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const base = `/seller/stores/${storeId}/orders/${order.id}`;

  const time = (iso: string) =>
    format.dateTime(new Date(iso), {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });

  async function send(path: string, body: unknown) {
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      setOrder(await apiRequest<SellerOrderDetail>('POST', `${base}/${path}`, body));
      toast({ title: t('done') });
      // Refreshes the menu badge of new orders.
      router.refresh();
      return true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 422) {
        const mapped = Object.fromEntries(
          Object.entries(cause.fieldErrors()).map(([path, code]) => [
            path.split('.')[0]!,
            validation.has(code) ? validation(code) : validation('generic'),
          ]),
        );
        setFieldErrors(mapped);
        setError(mapped.action ?? mapped.items ?? null);
      } else if (cause instanceof ApiError) {
        setError(cause.problem?.detail ?? errors('generic'));
      } else {
        setError(cause instanceof NetworkError ? errors('network') : errors('generic'));
      }
      return false;
    } finally {
      setPending(false);
    }
  }

  const act = (body: StoreActionRequest) => send('actions', body);
  const can = (action: SellerOrderDetail['actions'][number]) => order.actions.includes(action);

  function hint(): string | null {
    if (can('confirm')) return t('confirmHint');
    if (can('readyForPickup')) return t('readyHint');
    if (can('markPaid')) return t('payHint');
    if (can('requestCourier')) return t('courierHint');
    if (can('handToCourier')) return t('handHint');
    if (can('complete'))
      return order.fulfillment === 'PICKUP' ? t('pickupHint') : t('deliveredHint');
    return null;
  }

  function requestCourier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const trackingUrl = String(data.get('trackingUrl') ?? '').trim();
    void act({
      action: 'requestCourier',
      courierFee: parseTenge(String(data.get('courierFee') ?? '')) ?? -1,
      ...(trackingUrl ? { trackingUrl } : {}),
    });
  }

  function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('pickupCode') ?? '').trim();
    void act({
      action: 'complete',
      ...(order.fulfillment === 'PICKUP' ? { pickupCode: code } : {}),
    });
  }

  function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(
      new FormData(event.currentTarget).get('reason'),
    ) as (typeof STORE_CANCEL_REASONS)[number];
    if (!window.confirm(t('cancelConfirm'))) return;
    void act({ action: 'cancel', reason });
  }

  const nextHint = hint();
  return (
    <div className="grid max-w-3xl gap-5">
      <div className="grid gap-1">
        <Link href="/seller/orders" className="text-[13px] text-muted hover:text-ink">
          {t('back')}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{t('number', { number: order.number })}</h1>
          <Pill
            tone={order.status === 'NEW' ? 'sale' : order.status === 'CANCELLED' ? 'muted' : 'info'}
          >
            {to(`partStatuses.${order.status}`)}
          </Pill>
        </div>
        <p className="text-[13px] text-muted">{time(order.createdAt)}</p>
      </div>

      {order.confirmBy && <Notice>{t('confirmBy', { time: time(order.confirmBy) })}</Notice>}
      {order.pickupBy && (
        <Notice tone="info">{t('pickupBy', { time: time(order.pickupBy) })}</Notice>
      )}
      {order.cancelReason && (
        <Notice tone="info">
          {to.has(`cancelReasons.${order.cancelReason}`)
            ? to(`cancelReasons.${order.cancelReason}`)
            : order.cancelReason}
        </Notice>
      )}
      {error && <Notice>{error}</Notice>}

      {order.actions.length > 0 && (
        <section className="grid gap-3 rounded-2xl border-2 border-ink bg-surface p-4">
          <h2 className="font-bold">{t('nextStep')}</h2>
          {nextHint && <p className="text-[13.5px] text-muted">{nextHint}</p>}
          <div className="flex flex-wrap gap-2">
            {can('confirm') && (
              <Button disabled={pending} onClick={() => void act({ action: 'confirm' })}>
                {t('actions.confirm')}
              </Button>
            )}
            {can('readyForPickup') && (
              <Button disabled={pending} onClick={() => void act({ action: 'readyForPickup' })}>
                {t('actions.readyForPickup')}
              </Button>
            )}
            {can('markPaid') && (
              <Button disabled={pending} onClick={() => void act({ action: 'markPaid' })}>
                {t('actions.markPaid')}
              </Button>
            )}
            {can('handToCourier') && (
              <Button disabled={pending} onClick={() => void act({ action: 'handToCourier' })}>
                {t('actions.handToCourier')}
              </Button>
            )}
          </div>
          {can('requestCourier') && (
            <form
              onSubmit={requestCourier}
              className="grid gap-3 md:grid-cols-[180px_1fr_auto] md:items-end"
              noValidate
            >
              <TextField
                label={t('courierFee')}
                name="courierFee"
                inputMode="numeric"
                error={fieldErrors.courierFee}
                required
              />
              <TextField
                label={t('trackingUrl')}
                name="trackingUrl"
                type="url"
                placeholder="https://"
                error={fieldErrors.trackingUrl}
              />
              <Button type="submit" disabled={pending}>
                {t('actions.requestCourier')}
              </Button>
            </form>
          )}
          {can('complete') && (
            <form onSubmit={complete} className="flex flex-wrap items-end gap-3" noValidate>
              {order.fulfillment === 'PICKUP' && (
                <TextField
                  label={t('pickupCode')}
                  name="pickupCode"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  className="w-40"
                  error={fieldErrors.pickupCode}
                  required
                />
              )}
              <Button type="submit" disabled={pending}>
                {order.fulfillment === 'PICKUP'
                  ? t('actions.complete')
                  : t('actions.completeDelivery')}
              </Button>
            </form>
          )}
          {can('cancel') && (
            <form
              onSubmit={cancel}
              className="flex flex-wrap items-end gap-3 border-t border-dashed border-line pt-3"
              noValidate
            >
              <SelectField
                label={t('cancelReason')}
                name="reason"
                defaultValue="store.outOfStock"
                options={STORE_CANCEL_REASONS.map((value) => ({
                  value,
                  label: t(`cancelReasons.${value}`),
                }))}
              />
              <Button type="submit" variant="ghost" disabled={pending}>
                {t('actions.cancel')}
              </Button>
            </form>
          )}
        </section>
      )}

      <dl className="grid gap-2 rounded-2xl border border-line bg-surface p-4 text-[14px]">
        <Row label={t('customer')}>
          {order.contactName} ·{' '}
          <a
            href={`tel:${order.contactPhone}`}
            className="font-semibold underline underline-offset-4"
          >
            {order.contactPhone}
          </a>
        </Row>
        <Row label={t('fulfillment')}>
          {order.fulfillment === 'PICKUP' ? t('pickup') : t('delivery')}
        </Row>
        {order.fulfillment === 'DELIVERY' && (
          <Row label={t('payment')}>
            {order.paymentStatus === 'PAID_TO_SELLER' ? t('paid') : t('unpaid')}
          </Row>
        )}
        {order.deliveryAddress && <Row label={t('address')}>{order.deliveryAddress}</Row>}
        {order.deliveryComment && <Row label={t('comment')}>{order.deliveryComment}</Row>}
        {order.courierFee !== null && (
          <Row label={t('courierFee')}>{formatPrice(order.courierFee)}</Row>
        )}
        {order.courierTrackingUrl && (
          <Row label={t('tracking')}>
            <a
              href={order.courierTrackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              {new URL(order.courierTrackingUrl).host}
            </a>
          </Row>
        )}
      </dl>

      <ul className="grid gap-3 rounded-2xl border border-line bg-surface p-4">
        {order.items.map((item) => (
          <li key={item.id} className="grid grid-cols-[56px_1fr_auto] gap-3 text-[13.5px]">
            <div className="aspect-[3/4] overflow-hidden rounded-img bg-photo-1">
              {item.image && <ProductImage url={item.image.url} alt="" sizes="56px" />}
            </div>
            <div>
              <p className="font-semibold">
                {item.brand} {item.title}
              </p>
              <p className="tabular-nums text-muted">
                {item.size ? `EU ${item.size} · ` : ''}× {item.quantity} ·{' '}
                {t('sku', { sku: item.sku })}
                {item.returnedQuantity > 0 &&
                  ` · ${t('returned', { count: item.returnedQuantity })}`}
              </p>
            </div>
            <span className="font-bold tabular-nums">
              {formatPrice(item.unitPrice * item.quantity)}
            </span>
          </li>
        ))}
        <li className="flex justify-between border-t border-dashed border-line pt-3 font-bold tabular-nums">
          <span>{to('total')}</span>
          <span>{formatPrice(order.itemsTotal)}</span>
        </li>
      </ul>

      {order.status === 'COMPLETED' && (
        <ReturnsPanel
          order={order}
          pending={pending}
          fieldErrors={fieldErrors}
          onSubmit={(body) => send('returns', body)}
        />
      )}

      <section className="grid gap-2">
        <h2 className="text-[15px] font-bold">{t('history')}</h2>
        <ol className="grid gap-1 text-[13px]">
          {order.history.map((entry, index) => (
            <li key={index}>
              {time(entry.at)} — {to(`partStatuses.${entry.status}`)} ({t(`by.${entry.by}`)})
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function ReturnsPanel({
  order,
  pending,
  fieldErrors,
  onSubmit,
}: {
  order: SellerOrderDetail;
  pending: boolean;
  fieldErrors: Record<string, string>;
  onSubmit: (body: unknown) => Promise<boolean>;
}) {
  const t = useTranslations('sellerOrders');
  const format = useFormatter();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<(typeof REFUND_METHODS)[number]>('KASPI');

  const items = Object.entries(quantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));

  async function decide(decision: 'accept' | 'reject') {
    const ok = await onSubmit(
      decision === 'accept'
        ? { items, decision, refundMethod }
        : { items, decision, reason: reason.trim() },
    );
    if (ok) {
      setQuantities({});
      setReason('');
    }
  }

  return (
    <section className="grid gap-3 rounded-2xl border border-line bg-surface p-4">
      <h2 className="font-bold">{t('returnsTitle')}</h2>
      {order.canProcessReturn && order.returnBy ? (
        <>
          <p className="text-[13px] text-muted">
            {t('returnsHint', {
              date: format.dateTime(new Date(order.returnBy), { day: 'numeric', month: 'long' }),
            })}
          </p>
          <ul className="grid gap-2">
            {order.items.map((item) => {
              const left = item.quantity - item.returnedQuantity;
              return (
                <li key={item.id} className="flex items-center justify-between gap-3 text-[13.5px]">
                  <span>
                    {item.title}
                    {item.size ? `, EU ${item.size}` : ''}
                  </span>
                  <label className="flex items-center gap-2">
                    <span className="text-muted">{t('returnQuantity')}</span>
                    <input
                      type="number"
                      min={0}
                      max={left}
                      disabled={left === 0}
                      value={quantities[item.id] ?? 0}
                      onChange={(event) =>
                        setQuantities((current) => ({
                          ...current,
                          [item.id]: Math.max(0, Math.min(left, Number(event.target.value) || 0)),
                        }))
                      }
                      className="w-16 rounded-ctl border border-line bg-surface px-2 py-1 tabular-nums"
                    />
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="grid gap-3 md:grid-cols-2 md:items-start">
            <div className="grid gap-2">
              <SelectField
                label={t('refundMethod')}
                value={refundMethod}
                onChange={(event) => setRefundMethod(event.target.value as typeof refundMethod)}
                options={REFUND_METHODS.map((value) => ({
                  value,
                  label: t(`refundMethods.${value}`),
                }))}
              />
              <Button
                disabled={pending || items.length === 0}
                onClick={() => void decide('accept')}
              >
                {t('acceptReturn')}
              </Button>
            </div>
            <div className="grid gap-2">
              <TextField
                label={t('rejectReason')}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={300}
                error={fieldErrors.reason}
              />
              <Button
                variant="ghost"
                disabled={pending || items.length === 0}
                onClick={() => void decide('reject')}
              >
                {t('rejectReturn')}
              </Button>
            </div>
          </div>
        </>
      ) : (
        <p className="text-[13px] text-muted">{t('returnsClosed')}</p>
      )}
      {order.returns.length > 0 && (
        <ul className="grid gap-1 border-t border-dashed border-line pt-3 text-[13px]">
          {order.returns.map((entry, index) => (
            <li key={index}>
              {format.dateTime(new Date(entry.at), { day: 'numeric', month: 'short' })} ·{' '}
              {entry.title}
              {entry.size ? `, ${entry.size}` : ''} × {entry.quantity} —{' '}
              <b>{t(`returnStatus.${entry.status}`)}</b>
              {entry.refundMethod && ` (${t(`refundMethods.${entry.refundMethod}`)})`}
              {entry.reason && `: ${entry.reason}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
