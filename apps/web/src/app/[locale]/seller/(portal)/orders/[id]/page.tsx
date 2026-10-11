import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { SellerOrderView } from '@/components/seller/seller-order-view';
import { getMyStores, getStoreOrder } from '@/server/api';

export default async function SellerOrderPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const [store] = (await getMyStores()).filter((s) => s.status !== 'BLOCKED');
  const order = store ? await getStoreOrder(store.id, id) : null;
  if (!order) notFound();
  return <SellerOrderView storeId={store!.id} initial={order} />;
}
