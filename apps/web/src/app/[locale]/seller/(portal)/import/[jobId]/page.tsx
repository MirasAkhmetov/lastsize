import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ImportWizard } from '@/components/seller/import-wizard';
import { Link, redirect } from '@/i18n/navigation';
import {
  getCategories,
  getColors,
  getImportJob,
  getMinDiscount,
  getMyStores,
  getSizeCharts,
} from '@/server/api';

export default async function ImportJobPage({
  params,
}: {
  params: Promise<{ locale: string; jobId: string }>;
}) {
  const { locale, jobId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('imports');
  const [store] = (await getMyStores()).filter((s) => s.status !== 'BLOCKED');
  if (!store || store.role !== 'SELLER') redirect({ href: '/seller/import', locale });
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) notFound();
  const [job, categories, sizeCharts, colors, minDiscount] = await Promise.all([
    getImportJob(store!.id, jobId),
    getCategories(),
    getSizeCharts(),
    getColors(),
    getMinDiscount(),
  ]);
  if (!job) notFound();

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <Link href="/seller/import" className="text-[13px] text-muted hover:text-ink">
          {t('backToImport')}
        </Link>
        <h1 className="text-2xl font-bold">
          {t('jobTitle', { source: t(`sources.${job.source}`) })}
        </h1>
      </div>
      <ImportWizard
        storeId={store!.id}
        initialJob={job}
        categories={categories}
        sizeCharts={sizeCharts}
        colors={colors}
        minDiscount={minDiscount}
        canPublish={store!.status === 'VERIFIED'}
      />
    </div>
  );
}
