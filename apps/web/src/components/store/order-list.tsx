import type { OrderSummary } from '@lastsize/contracts';
import { formatPrice, Pill, ProductImage } from '@lastsize/ui';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

/** Orders of this device, newest first. */
export async function OrderList({ orders }: { orders: OrderSummary[] }) {
  const t = await getTranslations('orders');
  const format = await getFormatter();
  return (
    <ul className="grid gap-2">
      {orders.map((order) => (
        <li key={order.number}>
          <Link
            href={`/orders/${order.number}`}
            className="grid gap-2 rounded-2xl border border-line bg-surface p-4 hover:border-ink"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold">{t('number', { number: order.number })}</span>
              <Pill
                tone={
                  order.status === 'CANCELLED'
                    ? 'muted'
                    : order.status === 'COMPLETED'
                      ? 'ok'
                      : 'warn'
                }
              >
                {t(`statuses.${order.status}`)}
              </Pill>
            </div>
            <div className="flex gap-1.5">
              {order.images.map((image) => (
                <div
                  key={image.id}
                  className="aspect-[3/4] w-12 overflow-hidden rounded-img bg-photo-1"
                >
                  <ProductImage url={image.url} alt="" sizes="48px" />
                </div>
              ))}
            </div>
            <p className="text-[13px] text-muted">
              {format.dateTime(new Date(order.createdAt), { day: 'numeric', month: 'long' })} ·{' '}
              {order.storeNames.join(', ')} · {t('items', { count: order.itemCount })} ·{' '}
              <span className="font-semibold text-ink tabular-nums">
                {formatPrice(order.itemsTotal)}
              </span>
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
