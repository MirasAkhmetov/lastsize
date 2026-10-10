import { WEEKDAYS } from '@lastsize/contracts';
import { Pill } from '@lastsize/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CatalogListing } from '@/components/store/catalog-listing';
import { formatIntervals, todayInAlmaty } from '@/components/store/schedule';
import { getPathname } from '@/i18n/navigation';
import { hasFilters, parseCatalogParams } from '@/lib/catalog-params';
import { getCatalog, getPublicStore } from '@/server/api';

type Params = { locale: string; slug: string };
type Search = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const store = await getPublicStore(slug);
  if (!store) return {};
  const filtered = hasFilters(parseCatalogParams(await searchParams));
  const t = await getTranslations({ locale, namespace: 'meta' });
  const city = store.city[locale === 'kk' ? 'kk' : 'ru'];
  return {
    title: t('storeTitle', { name: store.name, city }),
    description: store.description?.slice(0, 160) ?? `${store.name}: ${store.address}, ${city}`,
    alternates: { canonical: getPathname({ href: `/store/${slug}`, locale }) },
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}

export default async function StorePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const store = await getPublicStore(slug);
  if (!store) notFound();
  const t = await getTranslations('storePage');
  const lang = locale === 'kk' ? 'kk' : 'ru';
  const query = parseCatalogParams(await searchParams);
  const data = await getCatalog({ ...query, store: [slug] });
  const today = todayInAlmaty();
  const since = new Intl.DateTimeFormat(lang === 'kk' ? 'kk-KZ' : 'ru-RU', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(store.since));

  return (
    <div className="grid gap-6 py-5">
      <header className="grid gap-4 rounded-2xl border border-line bg-surface p-4 md:grid-cols-[1fr_auto] md:p-6">
        <div className="grid content-start gap-2">
          <h1 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
            {store.name}
          </h1>
          <p className="text-[13px] text-muted">
            {t('since', { date: since })} · {t('products', { count: store.productCount })}
          </p>
          <p className="text-[14px]">
            {store.city[lang]}, {store.address}
          </p>
          <p className="text-[13.5px] tabular-nums select-all">{store.phone}</p>
          <div className="flex flex-wrap gap-2">
            {store.pickupEnabled && <Pill tone="ok">{t('pickup')}</Pill>}
            {store.instagram && <Pill tone="info">Instagram: @{store.instagram}</Pill>}
          </div>
          {store.description && (
            <p className="max-w-prose text-[14px] text-muted whitespace-pre-line">
              {store.description}
            </p>
          )}
        </div>
        <div className="grid content-start gap-1 text-[13px]">
          <p className="font-semibold">{t('schedule')}</p>
          <dl className="grid grid-cols-[32px_1fr] gap-x-2 gap-y-0.5 tabular-nums">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className={day === today ? 'contents font-semibold' : 'contents text-muted'}
              >
                <dt>{t(`days.${day}`)}</dt>
                <dd>{formatIntervals(store.schedule[day]) ?? t('closed')}</dd>
              </div>
            ))}
          </dl>
        </div>
      </header>
      {data && <CatalogListing data={data} query={query} basePath={`/store/${slug}`} hideStore />}
    </div>
  );
}
