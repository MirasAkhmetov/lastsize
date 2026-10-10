import { productPath, shortIdFromProductPath } from '@lastsize/contracts';
import { DiscountBadge, EmptyState, formatPrice, Notice, Price } from '@lastsize/ui';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PriceHistoryChart } from '@/components/store/price-history';
import { ProductGallery } from '@/components/store/product-gallery';
import { formatIntervals, todayInAlmaty } from '@/components/store/schedule';
import { SizePicker } from '@/components/store/size-picker';
import { getPathname, Link } from '@/i18n/navigation';
import { getProduct } from '@/server/api';
import { serverEnv } from '@/server/env';

type Params = { locale: string; slugId: string };

async function load(params: Params) {
  const shortId = shortIdFromProductPath(params.slugId);
  if (!shortId) return null;
  return getProduct(shortId);
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const routeParams = await params;
  const product = await load(routeParams);
  if (!product) return {};
  const path = getPathname({ href: productPath(product), locale: routeParams.locale });
  const t = await getTranslations({ locale: routeParams.locale, namespace: 'meta' });
  const title = t('productTitle', {
    title: `${product.brand?.name ?? ''} ${product.title}`.trim(),
    discount: product.discountPercent,
    price: formatPrice(product.salePrice),
  });
  const image = product.images[0] ? `${product.images[0].url}1080.webp` : undefined;
  return {
    title: `${title} | LastSize`,
    description:
      `${product.store.name}, ${product.store.city[routeParams.locale === 'kk' ? 'kk' : 'ru']}. ${product.description?.slice(0, 140) ?? ''}`.trim(),
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      title,
      images: image ? [{ url: image, width: 1080 }] : undefined,
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<Params> }) {
  const routeParams = await params;
  setRequestLocale(routeParams.locale);
  const product = await load(routeParams);
  if (!product) notFound();
  // Renamed products keep working links: redirect to the current slug.
  if (routeParams.slugId !== `${product.slug}-${product.shortId}`) {
    permanentRedirect(getPathname({ href: productPath(product), locale: routeParams.locale }));
  }

  const t = await getTranslations('product');
  const lang = routeParams.locale === 'kk' ? 'kk' : 'ru';
  const today = formatIntervals(product.store.schedule[todayInAlmaty()]);
  const site = serverEnv.NEXT_PUBLIC_SITE_URL;
  const url = `${site}${getPathname({ href: productPath(product), locale: routeParams.locale })}`;
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: `${product.brand?.name ?? ''} ${product.title}`.trim(),
      image: product.images.map((image) => `${site}${image.url}1080.webp`),
      description: product.description ?? undefined,
      sku: product.article ?? product.shortId,
      brand: product.brand ? { '@type': 'Brand', name: product.brand.name } : undefined,
      color: product.color?.name.ru,
      offers: {
        '@type': 'Offer',
        url,
        priceCurrency: 'KZT',
        price: (product.salePrice / 100).toFixed(0),
        availability:
          product.available > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        itemCondition: 'https://schema.org/NewCondition',
        seller: { '@type': 'Organization', name: product.store.name },
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { name: t('home'), path: '/' },
        ...(product.category.parent
          ? [
              {
                name: product.category.parent.name[lang],
                path: `/catalog/${product.category.parent.slug}`,
              },
            ]
          : []),
        { name: product.category.name[lang], path: `/catalog/${product.category.slug}` },
      ].map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        item: `${site}${getPathname({ href: item.path, locale: routeParams.locale })}`,
      })),
    },
  ];

  return (
    <div className="grid gap-6 py-4 md:py-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <nav aria-label="breadcrumbs" className="text-[12.5px] text-muted">
        <Link href="/" className="hover:text-ink">
          {t('home')}
        </Link>
        {product.category.parent && (
          <>
            {' / '}
            <Link href={`/catalog/${product.category.parent.slug}`} className="hover:text-ink">
              {product.category.parent.name[lang]}
            </Link>
          </>
        )}
        {' / '}
        <Link href={`/catalog/${product.category.slug}`} className="hover:text-ink">
          {product.category.name[lang]}
        </Link>
      </nav>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-10">
        <ProductGallery
          images={product.images}
          alt={`${product.brand?.name ?? ''} ${product.title}`}
          badge={
            product.discountPercent > 0 ? (
              <DiscountBadge percent={product.discountPercent} />
            ) : undefined
          }
        />

        <div className="grid content-start gap-5">
          <div className="grid gap-1">
            {product.brand && (
              <Link
                href={`/catalog?brand=${product.brand.slug}`}
                className="text-[13px] font-bold uppercase tracking-wide hover:text-sale"
              >
                {product.brand.name}
              </Link>
            )}
            <h1 className="text-2xl font-bold text-balance">{product.title}</h1>
          </div>

          <div className="grid gap-1">
            <Price
              salePrice={product.salePrice}
              originalPrice={product.referencePrice ?? product.originalPrice}
              size="lg"
              originalLabel={t('priceBefore')}
            />
            {product.referencePrice && (
              <p className="text-[12.5px] text-muted">
                {t('discountFromReference', { price: formatPrice(product.referencePrice) })}
              </p>
            )}
          </div>

          {product.available > 0 ? (
            <SizePicker sizes={product.sizes} />
          ) : (
            <EmptyState title={t('allSoldOut')} description={t('allSoldOutText')} />
          )}

          <section className="grid gap-2 rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <Link href={`/store/${product.store.slug}`} className="font-semibold hover:text-sale">
                {product.store.name}
              </Link>
              <Link
                href={`/store/${product.store.slug}`}
                className="text-[12.5px] text-muted underline underline-offset-4"
              >
                {t('allFromStore')}
              </Link>
            </div>
            <p className="text-[13.5px]">
              {product.store.city[lang]}, {product.store.address}
            </p>
            <p className="text-[13px] text-muted">
              {today ? `${t('today')}: ${today}` : t('closedToday')}
            </p>
            <p className="text-[13px]">
              {t('phone')}: <span className="tabular-nums select-all">{product.store.phone}</span>
            </p>
            <p
              className={
                product.store.pickupEnabled ? 'text-[13px] text-ok' : 'text-[13px] text-muted'
              }
            >
              {product.store.pickupEnabled ? t('pickup') : t('noPickup')}
            </p>
          </section>
          {product.store.deliveryEnabled && <Notice>{t('delivery')}</Notice>}
          <p className="text-[12.5px] text-muted">{t('returns')}</p>

          <section className="grid gap-2">
            <h2 className="font-bold">{t('details')}</h2>
            <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-[13.5px]">
              <dt className="text-muted">{t('category')}</dt>
              <dd>{product.category.name[lang]}</dd>
              <dt className="text-muted">{t('for')}</dt>
              <dd>{t(`genders.${product.gender}`)}</dd>
              {product.color && (
                <>
                  <dt className="text-muted">{t('color')}</dt>
                  <dd>{product.color.name[lang]}</dd>
                </>
              )}
              {product.composition && (
                <>
                  <dt className="text-muted">{t('composition')}</dt>
                  <dd>{product.composition}</dd>
                </>
              )}
              {product.article && (
                <>
                  <dt className="text-muted">{t('article')}</dt>
                  <dd className="tabular-nums select-all">{product.article}</dd>
                </>
              )}
            </dl>
            {product.description && (
              <p className="max-w-prose text-[14px] whitespace-pre-line">{product.description}</p>
            )}
          </section>

          {product.priceHistory.length > 1 && (
            <section className="grid gap-2">
              <h2 className="font-bold">{t('priceHistory')}</h2>
              <p className="text-[12.5px] text-muted">{t('priceHistoryHint')}</p>
              <PriceHistoryChart points={product.priceHistory} label={t('priceHistory')} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
