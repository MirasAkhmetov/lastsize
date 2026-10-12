import { formatPrice, Notice, Pill } from '@lastsize/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OrderCancel } from '@/components/order-cancel';
import { CANCEL_REASON, formatDateTime, ORDER_STATUS } from '@/components/order-labels';
import { getOrder } from '@/server/api';

export const metadata: Metadata = { title: 'Заказ' };

const ACTOR: Record<string, string> = {
  USER: 'магазин или поддержка',
  CUSTOMER: 'покупатель',
  SYSTEM: 'система',
  ANONYMOUS: '—',
};

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const order = await getOrder((await params).id);
  if (!order) notFound();
  return (
    <div className="grid max-w-3xl gap-5">
      <Link href="/orders" className="text-[13px] text-muted hover:text-ink">
        ← Заказы
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Заказ №{order.number}</h1>
        <Pill tone={ORDER_STATUS[order.status]!.tone}>{ORDER_STATUS[order.status]!.label}</Pill>
      </div>
      {order.cancelReason && (
        <Notice tone="info">{CANCEL_REASON[order.cancelReason] ?? order.cancelReason}</Notice>
      )}
      {(order.phoneBlocked || order.phoneProblems > 0) && (
        <Notice>
          {order.phoneBlocked ? 'Номер покупателя заблокирован. ' : ''}
          {order.phoneProblems > 0 &&
            `Проблемных заказов с этого номера за 90 дней: ${order.phoneProblems}.`}{' '}
          <Link href="/phones" className="underline">
            Номера
          </Link>
        </Notice>
      )}
      <dl className="grid gap-2 rounded-xl border border-line bg-surface p-4 text-[14px]">
        {[
          [
            'Магазин',
            <Link key="s" href={`/sellers/${order.storeId}`} className="underline">
              {order.storeName}
            </Link>,
          ],
          ['Покупатель', `${order.contactName} · ${order.contactPhone}`],
          [
            'Получение',
            order.fulfillment === 'PICKUP' ? 'Самовывоз' : `Курьер: ${order.deliveryAddress ?? ''}`,
          ],
          ['Оплата', order.paymentStatus === 'PAID_TO_SELLER' ? 'Оплачен магазину' : 'Не оплачен'],
          ...(order.courierFee !== null ? [['Доставка', formatPrice(order.courierFee)]] : []),
          ['Сумма товаров', formatPrice(order.itemsTotal)],
        ].map(([label, value]) => (
          <div key={String(label)} className="flex justify-between gap-3">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right">{value}</dd>
          </div>
        ))}
      </dl>
      <ul className="grid gap-1 rounded-xl border border-line bg-surface p-4 text-[13.5px]">
        {order.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-3">
            <span>
              {item.brand} {item.title}
              {item.size ? `, ${item.size}` : ''} × {item.quantity}
              {item.returnedQuantity > 0 && ` (возвращено ${item.returnedQuantity})`}
            </span>
            <span className="tabular-nums">{formatPrice(item.unitPrice * item.quantity)}</span>
          </li>
        ))}
      </ul>
      <section className="grid gap-1 text-[13px]">
        <h2 className="font-bold">История</h2>
        {order.history.map((entry, index) => (
          <p key={index}>
            {formatDateTime(entry.at)} — {ORDER_STATUS[entry.status]!.label} ({ACTOR[entry.by]})
            {entry.reason ? ` · ${CANCEL_REASON[entry.reason] ?? entry.reason}` : ''}
          </p>
        ))}
      </section>
      {order.canCancel && <OrderCancel orderId={order.id} />}
    </div>
  );
}
