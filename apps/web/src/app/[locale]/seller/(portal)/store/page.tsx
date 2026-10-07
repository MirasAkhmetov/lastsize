import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StoreForm } from '@/components/seller/store-form';
import { StoreStatusCard } from '@/components/seller/store-status';
import { getCities, getMyStore, getMyStores } from '@/server/api';

/** Create the store, or view and edit it. Managers see the data; only the owner may change it (API-enforced). */
export default async function SellerStorePage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('store');
  const [stores, cities] = await Promise.all([getMyStores(), getCities()]);
  const current = stores[0] ?? null;
  const store = current && current.status !== 'BLOCKED' ? await getMyStore(current.id) : null;

  return (
    <div className="grid max-w-3xl gap-6">
      <h1 className="text-2xl font-bold">{current ? t('editTitle') : t('createTitle')}</h1>
      {!current && <p className="max-w-prose text-[14px] text-muted">{t('createLead')}</p>}
      {current && (
        <StoreStatusCard
          name={current.name}
          status={current.status}
          reason={current.statusReason}
          showLink={false}
        />
      )}
      {(!current || store) && <StoreForm store={store} cities={cities} />}
    </div>
  );
}
