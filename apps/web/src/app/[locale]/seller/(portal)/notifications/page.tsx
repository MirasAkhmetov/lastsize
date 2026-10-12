import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NotificationCenter } from '@/components/notifications/notification-center';
import { PushToggle } from '@/components/notifications/push-toggle';
import { TelegramCard } from '@/components/seller/telegram-card';
import { getMyStores } from '@/server/api';

export default async function SellerNotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('notifications');
  const [store] = (await getMyStores()).filter((s) => s.status !== 'BLOCKED');
  return (
    <div className="grid max-w-3xl gap-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <section className="grid gap-3">
        <h2 className="text-[15px] font-bold">{t('channels')}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <TelegramCard />
          <PushToggle />
        </div>
      </section>
      {store && (
        <NotificationCenter
          base={`/seller/stores/${store.id}/notifications`}
          emptyText={t('emptyStore')}
        />
      )}
    </div>
  );
}
