import { buttonClasses, DiscountBadge, EmptyState, formatPrice, ProductImage } from '@lastsize/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ProductStatusPill } from '@/components/seller/product-status-pill';
import { Link } from '@/i18n/navigation';
import { getMyProducts, getMyStores } from '@/server/api';

export default async function SellerProductsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('products');
  const [store] = (await getMyStores()).filter((s) => s.status !== 'BLOCKED');
  if (!store) {
    return (
      <div className="grid max-w-3xl gap-6">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <EmptyState
          title={t('emptyTitle')}
          description={t('storeNeeded')}
          action={
            <Link href="/seller/store" className={buttonClasses('primary', 'sm')}>
              {t('new')}
            </Link>
          }
        />
      </div>
    );
  }
  const { items, total } = await getMyProducts(store.id);

  return (
    <div className="grid max-w-5xl gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          {t('title')}{' '}
          <span className="text-base font-normal text-muted tabular-nums">· {total}</span>
        </h1>
        <Link href="/seller/products/new" className={buttonClasses('primary', 'sm')}>
          + {t('new')}
        </Link>
      </div>
      {items.length === 0 ? (
        <EmptyState icon="+" title={t('emptyTitle')} description={t('emptyText')} />
      ) : (
        <ul className="grid gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/seller/products/${item.id}`}
                className="grid grid-cols-[56px_1fr] gap-3 rounded-xl border border-line bg-surface p-3 hover:border-ink md:grid-cols-[56px_1fr_160px_140px_170px] md:items-center"
              >
                <div className="aspect-[3/4] overflow-hidden rounded-img bg-photo-1">
                  {item.image && <ProductImage url={item.image.url} alt="" sizes="56px" />}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{item.title}</p>
                  <p className="truncate text-[13px] text-muted">{item.brand}</p>
                </div>
                <div className="col-start-2 flex items-center gap-2 text-[13px] tabular-nums md:col-start-auto">
                  <span className="font-bold">{formatPrice(item.salePrice)}</span>
                  {item.discountPercent > 0 && <DiscountBadge percent={item.discountPercent} />}
                </div>
                <div className="col-start-2 text-[12.5px] text-muted tabular-nums md:col-start-auto">
                  {t('pieces', { count: item.available })}
                  {item.sizes.some((s) => s.label) && (
                    <span className="block truncate">
                      {item.sizes
                        .map((s) => (s.available > 0 ? s.label : `${s.label}✕`))
                        .join(' · ')}
                    </span>
                  )}
                </div>
                <div className="col-start-2 md:col-start-auto">
                  <ProductStatusPill status={item.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
