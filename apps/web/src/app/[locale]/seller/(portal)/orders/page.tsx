import { SELLER_ORDER_STATUSES, type SellerOrderStatus } from '@lastsize/contracts';
import { cn, EmptyState, formatPrice, Pill } from '@lastsize/ui';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getMyStores, getStoreOrders } from '@/server/api';

export default async function SellerOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('sellerOrders');
  const to = await getTranslations('orders');
  const format = await getFormatter();
  const [store] = (await getMyStores()).filter((s) => s.status !== 'BLOCKED');
  if (!store) {
    return <EmptyState title={t('empty')} description={t('emptyText')} />;
  }
  const raw = (await searchParams).status;
  const status = SELLER_ORDER_STATUSES.includes(raw as SellerOrderStatus)
    ? (raw as SellerOrderStatus)
    : undefined;
  const list = await getStoreOrders(store.id, status);
  const time = (iso: string) =>
    format.dateTime(new Date(iso), {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="grid max-w-5xl gap-5">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <nav className="flex gap-2 overflow-x-auto pb-1 text-[13px]">
        <Link
          href="/seller/orders"
          className={cn(
            'rounded-full border px-3 py-1.5 whitespace-nowrap',
            !status ? 'border-ink bg-ink text-paper' : 'border-line',
          )}
        >
          {t('all')}
        </Link>
        {SELLER_ORDER_STATUSES.map((value) => (
          <Link
            key={value}
            href={`/seller/orders?status=${value}`}
            className={cn(
              'rounded-full border px-3 py-1.5 whitespace-nowrap',
              status === value ? 'border-ink bg-ink text-paper' : 'border-line',
            )}
          >
            {to(`partStatuses.${value}`)}{' '}
            <span className="tabular-nums opacity-70">{list.counts[value] ?? 0}</span>
          </Link>
        ))}
      </nav>
      {list.items.length === 0 ? (
        <EmptyState title={t('empty')} description={t('emptyText')} />
      ) : (
        <ul className="grid gap-2">
          {list.items.map((order) => (
            <li key={order.id}>
              <Link
                href={`/seller/orders/${order.id}`}
                className={cn(
                  'grid gap-1 rounded-xl border bg-surface p-3 hover:border-ink md:grid-cols-[1fr_auto_auto] md:items-center md:gap-4',
                  order.status === 'NEW' ? 'border-sale' : 'border-line',
                )}
              >
                <div>
                  <p className="font-semibold">
                    {t('number', { number: order.number })} · {order.contactName}
                  </p>
                  <p className="text-[12.5px] text-muted">
                    {time(order.createdAt)} ·{' '}
                    {order.fulfillment === 'PICKUP' ? t('pickup') : t('delivery')} ·{' '}
                    {t('items', { count: order.itemCount })}
                  </p>
                  {order.confirmBy && (
                    <p className="text-[12.5px] font-semibold text-sale">
                      {t('confirmBy', { time: time(order.confirmBy) })}
                    </p>
                  )}
                </div>
                <span className="font-bold tabular-nums">{formatPrice(order.itemsTotal)}</span>
                <Pill
                  tone={
                    order.status === 'NEW'
                      ? 'sale'
                      : order.status === 'CANCELLED'
                        ? 'muted'
                        : 'info'
                  }
                >
                  {to(`partStatuses.${order.status}`)}
                </Pill>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
