import { CATALOG_GENDERS, type CatalogGender } from '@lastsize/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CatalogListing } from '@/components/store/catalog-listing';
import { Link } from '@/i18n/navigation';
import { hasFilters, parseCatalogParams } from '@/lib/catalog-params';
import { getCatalog, getCategories } from '@/server/api';

type Params = { locale: string; segments?: string[] };
type Search = Record<string, string | string[] | undefined>;

const isGender = (value: string | undefined): value is CatalogGender =>
  CATALOG_GENDERS.includes(value as CatalogGender);

/** /catalog, /catalog/women, /catalog/shoes, /catalog/women/dresses */
async function resolve(params: Params) {
  const segments = params.segments ?? [];
  if (segments.length > 2) return null;
  const gender = isGender(segments[0]) ? segments[0] : undefined;
  const categorySlug = gender ? segments[1] : segments[0];
  if (!gender && segments.length > 1) return null;
  const categories = await getCategories();
  let category:
    | {
        slug: string;
        name: { ru: string; kk: string };
        parent?: { slug: string; name: { ru: string; kk: string } };
      }
    | undefined;
  if (categorySlug) {
    for (const root of categories) {
      if (root.slug === categorySlug) category = root;
      const child = root.children.find((c) => c.slug === categorySlug);
      if (child) category = { ...child, parent: root };
    }
    if (!category) return null;
  }
  return { gender, category, path: `/catalog${segments.length ? `/${segments.join('/')}` : ''}` };
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}): Promise<Metadata> {
  const resolved = await resolve(await params);
  if (!resolved) return {};
  const { locale } = await params;
  const lang = locale === 'kk' ? 'kk' : 'ru';
  const t = await getTranslations({ locale, namespace: 'catalog' });
  const filtered = hasFilters(parseCatalogParams(await searchParams));
  const title = [
    resolved.gender ? t(`genders.${resolved.gender}`) : null,
    resolved.category?.name[lang] ?? (resolved.gender ? null : t('allTitle')),
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    title: `${title} — SALE | LastSize`,
    alternates: { canonical: locale === 'kk' ? `/kk${resolved.path}` : resolved.path },
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}

export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const routeParams = await params;
  setRequestLocale(routeParams.locale);
  const resolved = await resolve(routeParams);
  if (!resolved) notFound();
  const t = await getTranslations('catalog');
  const nav = await getTranslations('product');
  const lang = routeParams.locale === 'kk' ? 'kk' : 'ru';
  const query = parseCatalogParams(await searchParams);
  const data = await getCatalog({
    ...query,
    gender: resolved.gender,
    category: resolved.category?.slug,
  });
  if (!data) notFound();

  const heading = query.q
    ? t('searchTitle', { q: query.q })
    : [resolved.gender ? t(`genders.${resolved.gender}`) : null, resolved.category?.name[lang]]
        .filter(Boolean)
        .join(' · ') || t('allTitle');

  return (
    <div className="grid gap-5 py-5">
      <nav aria-label="breadcrumbs" className="text-[12.5px] text-muted">
        <Link href="/" className="hover:text-ink">
          {nav('home')}
        </Link>
        {resolved.category?.parent && (
          <>
            {' / '}
            <Link href={`/catalog/${resolved.category.parent.slug}`} className="hover:text-ink">
              {resolved.category.parent.name[lang]}
            </Link>
          </>
        )}
      </nav>
      <h1 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
        {heading}{' '}
        <span className="text-base font-normal text-muted tabular-nums md:hidden">
          · {data.total}
        </span>
      </h1>
      <CatalogListing data={data} query={query} basePath={resolved.path} />
    </div>
  );
}
