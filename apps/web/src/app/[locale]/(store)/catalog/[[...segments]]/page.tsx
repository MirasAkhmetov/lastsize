import { buttonClasses, EmptyState } from '@lastsize/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export const metadata: Metadata = { robots: { index: false } };

export default async function CatalogPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('empty');
  const nav = await getTranslations('nav');
  return (
    <div className="py-10">
      <EmptyState
        icon="0"
        title={t('catalogTitle')}
        description={t('catalogText')}
        action={
          <Link href="/seller" className={buttonClasses('ghost', 'sm')}>
            {nav('forSellers')}
          </Link>
        }
      />
    </div>
  );
}
