import type { CatalogQuery, CatalogResponse } from '@lastsize/contracts';
import { buttonClasses, EmptyState } from '@lastsize/ui';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { catalogSearchParams } from '@/server/api';
import { CatalogCard } from './catalog-card';
import { CatalogFilters } from './catalog-filters';
import { type ActiveFilter, CatalogToolbar } from './catalog-toolbar';

/** Results grid with filters, sort, active chips and pagination; shared by the catalog and store pages. */
export async function CatalogListing({
  data,
  query,
  basePath,
  hideStore = false,
}: {
  data: CatalogResponse;
  query: Partial<CatalogQuery>;
  basePath: string;
  hideStore?: boolean;
}) {
  const t = await getTranslations('catalog');
  const lang = (await getLocale()) === 'kk' ? 'kk' : 'ru';
  const label = (list: { value: string; label: string }[], value: string) =>
    list.find((item) => item.value === value)?.label ?? value;

  const active: ActiveFilter[] = [
    ...(query.size ?? []).map((value) => ({
      key: 'size' as const,
      value,
      label: label(data.facets.sizes, value),
    })),
    ...(query.brand ?? []).map((value) => ({
      key: 'brand' as const,
      value,
      label: label(data.facets.brands, value),
    })),
    ...(hideStore
      ? []
      : (query.store ?? []).map((value) => ({
          key: 'store' as const,
          value,
          label: label(data.facets.stores, value),
        }))),
    ...(query.color ?? []).map((value) => {
      const color = data.facets.colors.find((c) => c.value === value);
      return {
        key: 'color' as const,
        value,
        label: color ? (lang === 'kk' ? color.labelKk : color.label) : value,
      };
    }),
    ...(query.priceMin !== undefined
      ? [
          {
            key: 'priceMin' as const,
            value: String(query.priceMin),
            label: `${t('priceFrom')} ${query.priceMin} ₸`,
          },
        ]
      : []),
    ...(query.priceMax !== undefined
      ? [
          {
            key: 'priceMax' as const,
            value: String(query.priceMax),
            label: `${t('priceTo')} ${query.priceMax} ₸`,
          },
        ]
      : []),
    ...(query.discount
      ? [
          {
            key: 'discount' as const,
            value: String(query.discount),
            label: t('discountFrom', { value: query.discount }),
          },
        ]
      : []),
    ...(query.pickup ? [{ key: 'pickup' as const, value: '1', label: t('pickupOnly') }] : []),
    ...(query.q ? [{ key: 'q' as const, value: query.q, label: `«${query.q}»` }] : []),
  ];
  const pageHref = (page: number) => {
    const params = catalogSearchParams({ ...query, page: page > 1 ? page : undefined });
    const search = params.toString();
    return search ? `${basePath}?${search}` : basePath;
  };

  return (
    <div className="grid gap-6 md:grid-cols-[240px_1fr]">
      <aside className="hidden md:block" aria-label={t('filters')}>
        <CatalogFilters facets={data.facets} query={query} hideStore={hideStore} />
      </aside>
      <div className="grid content-start gap-5">
        <CatalogToolbar
          facets={data.facets}
          query={query}
          active={active}
          total={data.total}
          hideStore={hideStore}
        />
        {data.items.length === 0 ? (
          <EmptyState
            icon="0"
            title={t('emptyFiltered')}
            description={t('emptyFilteredText')}
            action={
              active.length > 0 ? (
                <Link href={basePath} className={buttonClasses('ghost', 'sm')}>
                  {t('reset')}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
            {data.items.map((card, index) => (
              <li key={card.shortId}>
                <CatalogCard card={card} priority={index < 4} />
              </li>
            ))}
          </ul>
        )}
        {data.pages > 1 && (
          <nav
            aria-label={t('page', { page: data.page, pages: data.pages })}
            className="flex items-center justify-center gap-3 text-[13px]"
          >
            {data.page > 1 && (
              <Link
                href={pageHref(data.page - 1)}
                rel="prev"
                className={buttonClasses('ghost', 'sm')}
              >
                ← {t('prev')}
              </Link>
            )}
            <span className="text-muted tabular-nums">
              {t('page', { page: data.page, pages: data.pages })}
            </span>
            {data.page < data.pages && (
              <Link
                href={pageHref(data.page + 1)}
                rel="next"
                className={buttonClasses('ghost', 'sm')}
              >
                {t('next')} →
              </Link>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}
