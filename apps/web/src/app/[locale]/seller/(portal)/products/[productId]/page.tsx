import { Notice } from '@lastsize/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ProductForm } from '@/components/seller/product-form';
import { ProductStatusPill } from '@/components/seller/product-status-pill';
import { Link, redirect } from '@/i18n/navigation';
import {
  getCategories,
  getColors,
  getMinDiscount,
  getMyProduct,
  getMyStores,
  getSizeCharts,
} from '@/server/api';

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ locale: string; productId: string }>;
}) {
  const { locale, productId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('products');
  const [store] = (await getMyStores()).filter((s) => s.status !== 'BLOCKED');
  if (!store) redirect({ href: '/seller/store', locale });
  const [product, categories, sizeCharts, colors, minDiscount] = await Promise.all([
    getMyProduct(store!.id, productId),
    getCategories(),
    getSizeCharts(),
    getColors(),
    getMinDiscount(),
  ]);
  if (!product) notFound();
  const flags = product.flagReason?.split(',') ?? [];

  return (
    <div className="grid gap-6">
      <Link href="/seller/products" className="text-[13px] text-muted hover:text-ink">
        ← {t('title')}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{product.title}</h1>
        <ProductStatusPill status={product.status} />
      </div>
      {product.status === 'FLAGGED' &&
        flags.map((flag) => (
          <Notice key={flag}>{t.has(`flag.${flag}`) ? t(`flag.${flag}`) : flag}</Notice>
        ))}
      {product.removedReason && (
        <p className="rounded-lg bg-sale-soft px-3 py-2 text-[13.5px] text-sale">
          <span className="font-semibold">{t('removedReason')}:</span> {product.removedReason}
        </p>
      )}
      <ProductForm
        storeId={store!.id}
        product={product}
        categories={categories}
        sizeCharts={sizeCharts}
        colors={colors}
        minDiscount={minDiscount}
        canPublish={store!.status === 'VERIFIED'}
      />
    </div>
  );
}
