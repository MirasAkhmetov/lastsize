import { SELLER_ORDER_STATUSES, type SellerOrderStatus } from '@lastsize/contracts';
import { formatPrice, Pill } from '@lastsize/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDateTime, ORDER_STATUS } from '@/components/order-labels';
import { getOrders } from '@/server/api';

export const metadata: Metadata = { title: 'Заказы' };

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const status = SELLER_ORDER_STATUSES.includes(params.status as SellerOrderStatus)
    ? (params.status as SellerOrderStatus)
    : undefined;
  const query = params.q && /^[\d +()-]{3,20}$/.test(params.q.trim()) ? params.q.trim() : undefined;
  const page = Math.max(0, Number(params.page) || 0);
  const list = await getOrders(status, query, 50, page * 50);
  const href = (next: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({ status, q: query, ...next }))
      if (value) search.set(key, value);
    return `/orders?${search}`;
  };

  return (
    <div className="grid max-w-5xl gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Заказы</h1>
        <form className="flex gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <input
            name="q"
            type="search"
            defaultValue={query ?? ''}
            placeholder="Номер заказа или телефон"
            className="w-60 rounded-ctl border border-line bg-surface px-3 py-2 text-[14px]"
          />
          <button
            type="submit"
            className="rounded-ctl border border-line px-3 text-[13px] font-semibold"
          >
            Найти
          </button>
        </form>
      </div>
      <nav className="flex flex-wrap gap-1.5 text-[13px]">
        <Link
          href={href({ status: undefined, page: undefined })}
          className={`rounded-full border px-3 py-1 ${!status ? 'border-ink bg-ink text-paper' : 'border-line'}`}
        >
          Все
        </Link>
        {SELLER_ORDER_STATUSES.map((value) => (
          <Link
            key={value}
            href={href({ status: value, page: undefined })}
            className={`rounded-full border px-3 py-1 ${status === value ? 'border-ink bg-ink text-paper' : 'border-line'}`}
          >
            {ORDER_STATUS[value]!.label}
          </Link>
        ))}
      </nav>
      <p className="text-[13px] text-muted">Найдено: {list?.total ?? 0}</p>
      <ul className="grid gap-2">
        {list?.items.map((order) => (
          <li key={order.id}>
            <Link
              href={`/orders/${order.id}`}
              className="grid gap-1 rounded-xl border border-line bg-surface px-4 py-3 hover:border-ink md:grid-cols-[1fr_auto_auto] md:items-center md:gap-4"
            >
              <div>
                <p className="font-semibold">
                  №{order.number} · {order.storeName}
                </p>
                <p className="text-[12.5px] text-muted">
                  {formatDateTime(order.createdAt)} · {order.contactName} · {order.contactPhone} ·{' '}
                  {order.fulfillment === 'PICKUP' ? 'самовывоз' : 'курьер'}
                </p>
              </div>
              <span className="font-bold tabular-nums">{formatPrice(order.itemsTotal)}</span>
              <Pill tone={ORDER_STATUS[order.status]!.tone}>
                {ORDER_STATUS[order.status]!.label}
              </Pill>
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex gap-3 text-[13px]">
        {page > 0 && <Link href={href({ page: String(page - 1) })}>← Назад</Link>}
        {list && (page + 1) * 50 < list.total && (
          <Link href={href({ page: String(page + 1) })}>Дальше →</Link>
        )}
      </div>
    </div>
  );
}
