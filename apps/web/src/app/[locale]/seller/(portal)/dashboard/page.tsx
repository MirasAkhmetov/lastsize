import { buttonClasses, EmptyState, Notice } from '@lastsize/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StoreStatusCard } from '@/components/seller/store-status';
import { Link } from '@/i18n/navigation';
import { getMe, getMyStores } from '@/server/api';

export default async function SellerDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('seller');
  const [me, stores] = await Promise.all([getMe(), getMyStores()]);
  if (!me) return null; // the layout has already redirected

  return (
    <div className="grid max-w-4xl gap-6">
      <h1 className="text-2xl font-bold">{t('hello', { name: me.user.name })}</h1>
      {!me.user.phoneVerified && stores.length > 0 && (
        <Notice tone="info">{t('phoneUnverified')}</Notice>
      )}

      {stores.length === 0 ? (
        <EmptyState
          icon="+"
          title={t('noStoreTitle')}
          description={t('noStoreText')}
          action={
            <Link href="/seller/store" className={buttonClasses('primary')}>
              {t('createStore')}
            </Link>
          }
        />
      ) : (
        stores.map((store) => (
          <StoreStatusCard
            key={store.id}
            name={store.name}
            status={store.status}
            reason={store.statusReason}
            showLink
          />
        ))
      )}
    </div>
  );
}
