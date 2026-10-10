import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { OrderView } from '@/components/store/order-view';
import { getOrder } from '@/server/api';

export const metadata: Metadata = { robots: { index: false }, referrer: 'no-referrer' };

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; number: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { locale, number } = await params;
  setRequestLocale(locale);
  const { t: token } = await searchParams;
  const order = await getOrder(number, typeof token === 'string' ? token : undefined);
  if (!order) notFound();
  return (
    <div className="py-6">
      <OrderView initial={order} token={typeof token === 'string' ? token : undefined} />
    </div>
  );
}
