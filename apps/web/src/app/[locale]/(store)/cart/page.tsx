import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { CartView } from '@/components/store/cart-view';

export const metadata: Metadata = { robots: { index: false } };

export default async function CartPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <CartView />;
}
