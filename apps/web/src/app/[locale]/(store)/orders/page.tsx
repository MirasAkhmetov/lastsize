import { buttonClasses, EmptyState } from '@lastsize/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { OrderList } from '@/components/store/order-list';
import { Link } from '@/i18n/navigation';
import { getMyOrders } from '@/server/api';

export const metadata: Metadata = { robots: { index: false } };

export default async function OrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('orders');
  const empty = await getTranslations('empty');
  const orders = await getMyOrders();
  return (
    <div className="grid gap-4 py-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">{t('title')}</h1>
      {orders.length === 0 ? (
        <EmptyState
          title={empty('ordersTitle')}
          description={empty('ordersText')}
          action={
            <Link href="/catalog" className={buttonClasses('primary', 'sm')}>
              {empty('toSale')}
            </Link>
          }
        />
      ) : (
        <OrderList orders={orders} />
      )}
    </div>
  );
}
