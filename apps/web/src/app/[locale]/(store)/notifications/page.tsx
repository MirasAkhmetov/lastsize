import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NotificationCenter } from '@/components/notifications/notification-center';
import { PushToggle } from '@/components/notifications/push-toggle';

export const metadata: Metadata = { robots: { index: false } };

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('notifications');
  return (
    <div className="grid max-w-3xl gap-5 py-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">{t('title')}</h1>
      <NotificationCenter base="/customer/notifications" emptyText={t('emptyText')} />
      <PushToggle />
    </div>
  );
}
