import { EmptyState } from '@lastsize/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LanguageLink } from '@/components/language-link';
import { OrderList } from '@/components/store/order-list';
import { getMyOrders } from '@/server/api';

export const metadata: Metadata = { robots: { index: false } };

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('account');
  const empty = await getTranslations('empty');
  const orders = await getMyOrders();
  return (
    <div className="grid gap-6 py-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">{t('title')}</h1>
      <section className="grid gap-3">
        <h2 className="font-bold">{t('orders')}</h2>
        {orders.length === 0 ? (
          <EmptyState title={empty('ordersTitle')} description={empty('ordersText')} />
        ) : (
          <OrderList orders={orders} />
        )}
      </section>
      <section className="flex items-center justify-between rounded-xl border border-line bg-surface p-4">
        <h2 className="font-bold">{t('language')}</h2>
        <LanguageLink className="text-[14px] underline underline-offset-4">
          {locale === 'kk' ? t('languageRu') : t('languageKk')}
        </LanguageLink>
      </section>
    </div>
  );
}
