import { Button, EmptyState, Notice, Pill } from '@lastsize/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getMe } from '@/server/api';

export default async function SellerDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('seller');
  const me = await getMe();
  if (!me) return null; // the layout has already redirected

  return (
    <div className="grid max-w-4xl gap-6">
      <h1 className="text-2xl font-bold">{t('hello', { name: me.user.name })}</h1>
      {!me.user.phoneVerified && <Notice tone="info">{t('phoneUnverified')}</Notice>}

      {me.stores.length === 0 ? (
        <EmptyState
          icon="+"
          title={t('noStoreTitle')}
          description={t('noStoreText')}
          action={
            <Button disabled aria-describedby="store-soon">
              {t('createStore')}{' '}
              <span id="store-soon" className="text-[11px] font-normal">
                ({t('soon')})
              </span>
            </Button>
          }
        />
      ) : (
        <section className="grid gap-3">
          <h2 className="font-bold">{t('storesTitle')}</h2>
          <ul className="grid gap-2">
            {me.stores.map((store) => (
              <li
                key={store.storeId}
                className="flex items-center justify-between rounded-xl border border-line bg-surface p-4"
              >
                <span className="font-semibold">{store.storeName}</span>
                <Pill tone="info">{store.role === 'SELLER' ? 'Владелец' : 'Менеджер'}</Pill>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
