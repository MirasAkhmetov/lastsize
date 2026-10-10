import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { CheckoutForm } from '@/components/store/checkout-form';

export const metadata: Metadata = { robots: { index: false } };

export default async function CheckoutPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <CheckoutForm />;
}
