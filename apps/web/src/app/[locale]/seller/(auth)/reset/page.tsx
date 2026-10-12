import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PasswordResetForm } from '@/components/seller/password-reset';

export const metadata: Metadata = { robots: { index: false }, referrer: 'no-referrer' };

export default async function ResetPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('seller');
  const { token } = await searchParams;
  const valid = typeof token === 'string' && /^[A-Za-z0-9_-]{30,64}$/.test(token) ? token : null;
  return (
    <div className="grid gap-5">
      <h1 className="text-2xl font-bold">{t('resetTitle')}</h1>
      <PasswordResetForm token={valid} />
    </div>
  );
}
