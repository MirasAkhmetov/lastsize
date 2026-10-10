import { buttonClasses } from '@lastsize/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { OrderLink, OrderView } from '@/components/store/order-view';
import { Link } from '@/i18n/navigation';
import { getOrder } from '@/server/api';

export const metadata: Metadata = { robots: { index: false }, referrer: 'no-referrer' };

export default async function CheckoutSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; number: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { locale, number } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('orders');
  const { t: raw } = await searchParams;
  const token = typeof raw === 'string' ? raw : undefined;
  const order = await getOrder(number, token);
  if (!order) notFound();
  return (
    <div className="grid gap-5 py-6">
      <section className="grid gap-2 rounded-2xl bg-ink p-5 text-paper">
        <h1 className="font-display text-2xl font-bold">
          {t('successTitle', { number: order.number })}
        </h1>
        <p className="text-[14px] opacity-85">{t('successText')}</p>
      </section>
      {token && <OrderLink number={order.number} token={token} />}
      <OrderView initial={order} token={token} />
      <Link href="/catalog" className={buttonClasses('ghost', 'md')}>
        {t('toCatalog')}
      </Link>
    </div>
  );
}
