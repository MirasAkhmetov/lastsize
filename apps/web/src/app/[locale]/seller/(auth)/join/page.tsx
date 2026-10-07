import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SellerAuthForm } from '@/components/seller/auth-forms';
import { Link } from '@/i18n/navigation';

export const metadata: Metadata = { robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('seller');
  return (
    <div className="grid gap-5">
      <h1 className="text-2xl font-bold">{t('joinTitle')}</h1>
      <p className="text-[14px] text-muted">{t('joinLead')}</p>
      <SellerAuthForm mode="join" />
      <p className="text-[14px] text-muted">
        {t('haveAccount')}{' '}
        <Link href="/seller/login" className="font-semibold text-ink underline underline-offset-4">
          {t('login')}
        </Link>
      </p>
    </div>
  );
}
