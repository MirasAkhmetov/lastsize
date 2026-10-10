import { buttonClasses } from '@lastsize/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { CatalogCard } from '@/components/store/catalog-card';
import { getCatalog, getCategories } from '@/server/api';

// Rendered per request so a deploy never serves a page built while the API was unreachable;
// the category data itself is cached for 5 minutes (see getCategories).
export const dynamic = 'force-dynamic';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  const [categories, bigDiscounts, lastSizes, newest] = await Promise.all([
    getCategories(),
    getCatalog({ sort: 'discount' }).catch(() => null),
    getCatalog({ sort: 'last_sizes' }).catch(() => null),
    getCatalog({ sort: 'newest' }).catch(() => null),
  ]);
  const sections = await getTranslations('homeSections');
  const rails = [
    {
      key: 'bigDiscounts',
      href: '/catalog?sort=discount',
      items: bigDiscounts?.items.slice(0, 8) ?? [],
    },
    {
      key: 'lastSizes',
      href: '/catalog?sort=last_sizes',
      items: lastSizes?.items.filter((item) => item.available <= 2).slice(0, 8) ?? [],
    },
    { key: 'newest', href: '/catalog', items: newest?.items.slice(0, 8) ?? [] },
  ] as const;
  const lang = locale === 'kk' ? 'kk' : 'ru';

  return (
    <div className="grid gap-12 py-6 md:py-10">
      <section className="grid gap-5 rounded-2xl bg-ink p-5 text-paper md:grid-cols-[1.2fr_1fr] md:items-end md:p-10">
        <div className="grid gap-4">
          <span className="w-fit rounded-full bg-ok-soft px-3 py-1 text-xs font-semibold text-ok">
            {t('badge')}
          </span>
          <h1 className="font-display text-[44px] leading-[0.9] font-black tracking-tight md:text-[88px]">
            {t('headlineSale')}
            <br />
            <span className="text-sale">{t('headlineDiscount')}</span>
          </h1>
        </div>
        <div className="grid gap-5">
          <p className="max-w-prose text-[15px] text-pretty opacity-85 md:text-lg">{t('lead')}</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/catalog" className={buttonClasses('sale')}>
              {t('ctaSale')}
            </Link>
            <Link
              href="/seller"
              className={buttonClasses('ghost') + ' border-paper/30 text-paper hover:bg-paper/10'}
            >
              {t('ctaSell')}
            </Link>
          </div>
        </div>
      </section>

      {rails
        .filter((rail) => rail.items.length > 0)
        .map((rail) => (
          <section key={rail.key} className="grid gap-4" aria-labelledby={`rail-${rail.key}`}>
            <div className="flex items-baseline justify-between">
              <h2
                id={`rail-${rail.key}`}
                className="font-display text-2xl font-bold tracking-tight"
              >
                {sections(rail.key)}
              </h2>
              <Link href={rail.href} className="text-[13px] text-muted hover:text-ink">
                {sections('all')} →
              </Link>
            </div>
            <ul className="grid auto-cols-[44%] grid-flow-col gap-3 overflow-x-auto pb-2 sm:auto-cols-[30%] md:grid-flow-row md:grid-cols-4">
              {rail.items.map((card) => (
                <li key={card.shortId}>
                  <CatalogCard card={card} />
                </li>
              ))}
            </ul>
          </section>
        ))}

      {categories.length > 0 && (
        <section className="grid gap-4" aria-labelledby="categories-title">
          <h2 id="categories-title" className="font-display text-2xl font-bold tracking-tight">
            {t('categoriesTitle')}
          </h2>
          <div className="grid gap-3 md:grid-cols-3">
            {categories.map((category) => (
              <div
                key={category.id}
                className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4"
              >
                <Link
                  href={`/catalog/${category.slug}`}
                  className="text-lg font-bold hover:text-sale"
                >
                  {category.name[lang]}
                </Link>
                <ul className="flex flex-wrap gap-1.5">
                  {category.children.map((child) => (
                    <li key={child.id}>
                      <Link
                        href={`/catalog/${child.slug}`}
                        className="inline-block rounded-full border border-line px-3 py-1 text-[13px] hover:border-ink"
                      >
                        {child.name[lang]}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-4" aria-labelledby="how-title">
        <h2 id="how-title" className="font-display text-2xl font-bold tracking-tight">
          {t('howTitle')}
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {(['how1', 'how2', 'how3'] as const).map((key) => (
            <div
              key={key}
              className="grid content-start gap-1.5 rounded-xl border border-line bg-surface p-4"
            >
              <h3 className="font-bold">{t(`${key}Title`)}</h3>
              <p className="text-[14px] text-muted">{t(`${key}Text`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-3 rounded-2xl border border-line bg-surface p-5 md:grid-cols-[1fr_auto] md:items-center md:p-8">
        <div className="grid gap-1.5">
          <h2 className="font-display text-xl font-bold tracking-tight">{t('sellersTitle')}</h2>
          <p className="max-w-prose text-muted">{t('sellersText')}</p>
        </div>
        <Link href="/seller" className={buttonClasses('primary')}>
          {t('sellersCta')}
        </Link>
      </section>
    </div>
  );
}
