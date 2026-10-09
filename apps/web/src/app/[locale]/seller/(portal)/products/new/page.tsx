import { Notice } from '@lastsize/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ProductForm } from '@/components/seller/product-form';
import { redirect } from '@/i18n/navigation';
import { getCategories, getColors, getMinDiscount, getMyStores, getSizeCharts } from '@/server/api';

export default async function NewProductPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('products');
  const [store] = (await getMyStores()).filter((s) => s.status !== 'BLOCKED');
  if (!store) redirect({ href: '/seller/store', locale });
  const [categories, sizeCharts, colors, minDiscount] = await Promise.all([
    getCategories(),
    getSizeCharts(),
    getColors(),
    getMinDiscount(),
  ]);

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-bold">{t('createTitle')}</h1>
      {store!.status !== 'VERIFIED' && <Notice tone="info">{t('storePending')}</Notice>}
      <ProductForm
        storeId={store!.id}
        product={null}
        categories={categories}
        sizeCharts={sizeCharts}
        colors={colors}
        minDiscount={minDiscount}
        canPublish={store!.status === 'VERIFIED'}
      />
    </div>
  );
}
