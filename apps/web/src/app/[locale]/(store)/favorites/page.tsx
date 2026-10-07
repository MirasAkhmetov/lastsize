import { buttonClasses, EmptyState } from '@lastsize/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export const metadata: Metadata = { robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('empty');
  return (
    <div className="py-10">
      <EmptyState
        icon="♡"
        title={t('favoritesTitle')}
        description={t('favoritesText')}
        action={
          <Link href="/catalog" className={buttonClasses('primary', 'sm')}>
            {t('toSale')}
          </Link>
        }
      />
    </div>
  );
}
