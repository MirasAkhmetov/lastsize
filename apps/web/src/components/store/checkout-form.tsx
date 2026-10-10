'use client';

import type {} from 'altcha/types/react';
import {
  ApiError,
  apiRequest,
  type Cart,
  NetworkError,
  type OrderCreated,
} from '@lastsize/contracts';
import {
  Button,
  buttonClasses,
  cn,
  EmptyState,
  formatPrice,
  Notice,
  Skeleton,
  TextAreaField,
  TextField,
} from '@lastsize/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { announceCartCount } from './cart-count';

type AltchaWidget = HTMLElement & {
  verify: () => Promise<{ payload: string } | null>;
  reset: () => void;
};
type Choice = { type: 'PICKUP' | 'DELIVERY'; address: string; comment: string };

/**
 * Checkout without SMS: name, phone and how each store's part is received. A proof-of-work
 * runs in the background from the moment the page opens, so honest buyers do not wait.
 */
export function CheckoutForm() {
  const t = useTranslations('checkout');
  const empty = useTranslations('empty');
  const validation = useTranslations('validation');
  const errors = useTranslations('errors');
  const router = useRouter();
  const widgetRef = useRef<AltchaWidget | null>(null);
  const proof = useRef<Promise<string | null> | null>(null);
  // One key per checkout attempt: a double submit or a retry returns the same order.
  const idempotencyKey = useRef<string>('');
  const [cart, setCart] = useState<Cart | null>(null);
  const [profile, setProfile] = useState<{ name: string | null; phone: string | null }>({
    name: null,
    phone: null,
  });
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [pending, setPending] = useState<'verifying' | 'placing' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const loadCart = useCallback(async () => {
    const next = await apiRequest<Cart>('GET', '/cart');
    setCart(next);
    setChoices((current) =>
      Object.fromEntries(
        next.stores.map((store) => [
          store.storeId,
          current[store.storeId] ?? {
            type: store.pickupEnabled ? 'PICKUP' : 'DELIVERY',
            address: '',
            comment: '',
          },
        ]),
      ),
    );
  }, []);

  const startProof = useCallback(() => {
    proof.current = (async () => {
      const widget = widgetRef.current;
      if (!widget) return null;
      widget.reset();
      return (await widget.verify())?.payload ?? null;
    })().catch(() => null);
  }, []);

  useEffect(() => {
    idempotencyKey.current = crypto.randomUUID();
    void loadCart().catch(() => setNotice(errors('generic')));
    void apiRequest<{ name: string | null; phone: string | null }>('GET', '/customer/me')
      .then(setProfile)
      .catch(() => undefined);
    void import('altcha').then(() => {
      void customElements.whenDefined('altcha-widget').then(startProof);
    });
  }, [errors, loadCart, startProof]);

  const translate = (code: string) =>
    validation.has(code) ? validation(code) : validation('generic');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cart) return;
    const data = new FormData(event.currentTarget);
    setNotice(null);
    setFieldErrors({});
    setPending('verifying');
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const altcha = await (proof.current ?? Promise.resolve(null));
        setPending('placing');
        try {
          const created = await apiRequest<OrderCreated>(
            'POST',
            '/orders',
            {
              contact: {
                name: String(data.get('name') ?? '').trim(),
                phone: String(data.get('phone') ?? '').trim(),
              },
              fulfillment: cart.stores.map((store) => {
                const choice = choices[store.storeId]!;
                return {
                  storeId: store.storeId,
                  type: choice.type,
                  ...(choice.type === 'DELIVERY' ? { address: choice.address.trim() } : {}),
                  ...(choice.comment.trim() ? { comment: choice.comment.trim() } : {}),
                };
              }),
              altcha: altcha ?? '',
            },
            { headers: { 'idempotency-key': idempotencyKey.current } },
          );
          announceCartCount(0);
          router.replace(
            `/checkout/success/${created.number}${created.accessToken ? `?t=${created.accessToken}` : ''}`,
          );
          return;
        } catch (cause) {
          // The challenge expired or was spent: solve a fresh one and try once more.
          const altchaFailed =
            cause instanceof ApiError &&
            cause.status === 422 &&
            Object.keys(cause.fieldErrors()).includes('altcha');
          startProof();
          if (altchaFailed && attempt === 0) {
            setPending('verifying');
            continue;
          }
          throw cause;
        }
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        const code = cause.problem?.code;
        setNotice(
          code === 'PRICE_CHANGED'
            ? t('priceChanged')
            : code === 'OUT_OF_STOCK'
              ? t('outOfStock')
              : t('cartChanged'),
        );
        // The cart changed, so this is a new attempt.
        idempotencyKey.current = crypto.randomUUID();
        await loadCart().catch(() => undefined);
      } else if (cause instanceof ApiError && cause.status === 422) {
        const mapped = Object.fromEntries(
          Object.entries(cause.fieldErrors()).map(([path, code]) => [path, translate(code)]),
        );
        setFieldErrors(mapped);
        if (mapped.form || mapped.altcha || mapped.idempotencyKey)
          setNotice(mapped.form ?? mapped.altcha ?? mapped.idempotencyKey ?? null);
      } else if (cause instanceof ApiError) {
        setNotice(cause.problem?.detail ?? errors('generic'));
      } else {
        setNotice(cause instanceof NetworkError ? errors('network') : errors('generic'));
      }
    } finally {
      setPending(null);
    }
  }

  if (!cart) {
    return (
      <div className="grid gap-3 py-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (cart.stores.length === 0) {
    return (
      <div className="py-10">
        <EmptyState
          icon="0"
          title={t('empty')}
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
    <form
      onSubmit={submit}
      noValidate
      className="grid gap-6 py-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start"
    >
      <div className="grid gap-6">
        <div className="grid gap-1">
          <Link href="/cart" className="text-[13px] text-muted hover:text-ink">
            {t('backToCart')}
          </Link>
          <h1 className="font-display text-2xl font-bold tracking-tight">{t('title')}</h1>
        </div>
        {notice && <Notice>{notice}</Notice>}

        <section className="grid gap-3 rounded-2xl border border-line bg-surface p-4">
          <h2 className="font-bold">{t('contact')}</h2>
          <p className="text-[13px] text-muted">{t('contactHint')}</p>
          <div className="grid gap-3 md:grid-cols-2 md:items-start">
            <TextField
              label={t('name')}
              name="name"
              autoComplete="name"
              defaultValue={profile.name ?? ''}
              key={`name-${profile.name ?? ''}`}
              maxLength={60}
              error={fieldErrors['contact.name']}
              required
            />
            <TextField
              label={t('phone')}
              name="phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              defaultValue={profile.phone ?? '+7 '}
              key={`phone-${profile.phone ?? ''}`}
              hint={t('phoneHint')}
              error={fieldErrors['contact.phone']}
              required
            />
          </div>
        </section>

        {cart.stores.map((store, index) => {
          const choice = choices[store.storeId];
          if (!choice) return null;
          const set = (patch: Partial<Choice>) =>
            setChoices((current) => ({ ...current, [store.storeId]: { ...choice, ...patch } }));
          return (
            <section
              key={store.storeId}
              className="grid gap-3 rounded-2xl border border-line bg-surface p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-bold">
                  {t('receive')}: {store.name}
                </h2>
                <span className="text-[13px] tabular-nums text-muted">
                  {formatPrice(store.itemsTotal)}
                </span>
              </div>
              <div className="grid gap-2 md:grid-cols-2" role="radiogroup">
                {(['PICKUP', 'DELIVERY'] as const).map((type) => {
                  const offered = type === 'PICKUP' ? store.pickupEnabled : store.deliveryEnabled;
                  if (!offered) return null;
                  return (
                    <label
                      key={type}
                      className={cn(
                        'flex cursor-pointer gap-2 rounded-ctl border p-3 text-[13px]',
                        choice.type === type ? 'border-2 border-ink' : 'border-line',
                      )}
                    >
                      <input
                        type="radio"
                        name={`fulfillment-${store.storeId}`}
                        className="mt-0.5 accent-ink"
                        checked={choice.type === type}
                        onChange={() => set({ type })}
                      />
                      <span className="grid gap-0.5">
                        <b>{type === 'PICKUP' ? t('pickup') : t('delivery')}</b>
                        <span className="text-muted">
                          {type === 'PICKUP'
                            ? `${t('pickupText')} · ${store.address}`
                            : t('deliveryText')}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {choice.type === 'DELIVERY' && (
                <TextField
                  label={t('address')}
                  hint={t('addressHint')}
                  autoComplete="street-address"
                  value={choice.address}
                  onChange={(event) => set({ address: event.target.value })}
                  maxLength={300}
                  error={fieldErrors[`fulfillment.${index}.address`]}
                  required
                />
              )}
              <TextAreaField
                label={t('comment')}
                rows={2}
                value={choice.comment}
                onChange={(event) => set({ comment: event.target.value })}
                maxLength={300}
                error={
                  fieldErrors[`fulfillment.${index}.comment`] ??
                  fieldErrors[`fulfillment.${store.storeId}`]
                }
              />
            </section>
          );
        })}

        <section className="grid gap-1 rounded-2xl border border-line bg-surface p-4">
          <h2 className="font-bold">{t('payment')}</h2>
          <p className="text-[13px] text-muted">{t('paymentText')}</p>
        </section>
      </div>

      <aside className="grid gap-3 rounded-2xl border border-line bg-surface p-4 lg:sticky lg:top-28">
        <h2 className="font-bold">{t('summary')}</h2>
        <div className="flex justify-between text-[13.5px] tabular-nums">
          <span>{t('items')}</span>
          <span>{formatPrice(cart.itemsTotal)}</span>
        </div>
        <p className="text-[12.5px] text-muted">{t('deliveryExtra')}</p>
        <Button type="submit" block disabled={pending !== null || cart.hasProblems}>
          {pending === 'verifying'
            ? t('verifying')
            : pending === 'placing'
              ? t('placing')
              : t('place')}
        </Button>
        <p className="text-[11.5px] text-muted">{t('terms')}</p>
        <altcha-widget
          ref={(element: HTMLElement | null) => {
            widgetRef.current = element as AltchaWidget | null;
          }}
          challenge="/api/v1/orders/challenge"
          display="invisible"
          auto="off"
        />
      </aside>
    </form>
  );
}
