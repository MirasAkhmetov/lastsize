import { formatPrice, Notice, Pill, ProductImage } from '@lastsize/ui';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getMyStores, getStoreOrder } from '@/server/api';

export default async function SellerOrderPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('sellerOrders');
  const to = await getTranslations('orders');
  const format = await getFormatter();
  const [store] = (await getMyStores()).filter((s) => s.status !== 'BLOCKED');
  const order = store ? await getStoreOrder(store.id, id) : null;
  if (!order) notFound();
  const time = (iso: string) =>
    format.dateTime(new Date(iso), {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="grid max-w-3xl gap-5">
      <div className="grid gap-1">
        <Link href="/seller/orders" className="text-[13px] text-muted hover:text-ink">
          {t('back')}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{t('number', { number: order.number })}</h1>
          <Pill tone={order.status === 'NEW' ? 'sale' : 'info'}>
            {to(`partStatuses.${order.status}`)}
          </Pill>
        </div>
        <p className="text-[13px] text-muted">{time(order.createdAt)}</p>
      </div>
      {order.confirmBy && (
        <Notice>
          {t('call')}. {t('confirmBy', { time: time(order.confirmBy) })}
        </Notice>
      )}
      <Notice tone="info">{t('actionsSoon')}</Notice>

      <dl className="grid gap-2 rounded-2xl border border-line bg-surface p-4 text-[14px]">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">{t('customer')}</dt>
          <dd className="text-right">
            {order.contactName} ·{' '}
            <a
              href={`tel:${order.contactPhone}`}
              className="font-semibold underline underline-offset-4"
            >
              {order.contactPhone}
            </a>
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">{t('fulfillment')}</dt>
          <dd>{order.fulfillment === 'PICKUP' ? t('pickup') : t('delivery')}</dd>
        </div>
        {order.deliveryAddress && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t('address')}</dt>
            <dd className="text-right">{order.deliveryAddress}</dd>
          </div>
        )}
        {order.deliveryComment && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t('comment')}</dt>
            <dd className="text-right">{order.deliveryComment}</dd>
          </div>
        )}
      </dl>

      <ul className="grid gap-3 rounded-2xl border border-line bg-surface p-4">
        {order.items.map((item, index) => (
          <li key={index} className="grid grid-cols-[56px_1fr_auto] gap-3 text-[13.5px]">
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
