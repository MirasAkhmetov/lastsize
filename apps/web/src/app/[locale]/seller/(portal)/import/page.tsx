import { EmptyState, Notice, buttonClasses } from '@lastsize/ui';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { ImportSources } from '@/components/seller/import-sources';
import { Link } from '@/i18n/navigation';
import { getImportJobs, getIntegrations, getMyStores } from '@/server/api';

export default async function ImportPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('imports');
  const format = await getFormatter();
  const [store] = (await getMyStores()).filter((s) => s.status !== 'BLOCKED');

  if (!store) {
    return (
      <div className="grid max-w-3xl gap-6">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <EmptyState
          title={t('title')}
          description={t('storeNeeded')}
          action={
            <Link href="/seller/store" className={buttonClasses('primary', 'sm')}>
              {t('title')}
            </Link>
          }
        />
      </div>
    );
  }
  if (store.role !== 'SELLER') {
    return (
      <div className="grid max-w-3xl gap-6">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <Notice tone="info">{t('ownerOnly')}</Notice>
      </div>
    );
  }

  const [integrations, jobs] = await Promise.all([
    getIntegrations(store.id),
    getImportJobs(store.id),
  ]);

  return (
    <div className="grid max-w-5xl gap-8">
      <header className="grid gap-2">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="max-w-2xl text-[14px] text-muted">{t('lead')}</p>
      </header>
      <ImportSources storeId={store.id} integrations={integrations} />
      {jobs.length > 0 && (
        <section className="grid gap-3">
          <h2 className="text-[15px] font-bold">{t('recentTitle')}</h2>
          <ul className="grid gap-2">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/seller/import/${job.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-3 hover:border-ink"
                >
                  <span className="font-semibold">{t(`sources.${job.source}`)}</span>
                  <span className="text-[13px] text-muted tabular-nums">
                    {t('recentSummary', {
                      total: job.counts.total,
                      published: job.counts.published,
                    })}
                  </span>
                  <time className="text-[13px] text-muted" dateTime={job.createdAt}>
                    {format.dateTime(new Date(job.createdAt), {
                      day: 'numeric',
                      month: 'long',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
