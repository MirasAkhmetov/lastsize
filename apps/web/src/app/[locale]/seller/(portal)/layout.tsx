import { Logo } from '@lastsize/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { LanguageLink } from '@/components/language-link';
import { LogoutButton } from '@/components/seller/auth-forms';
import { PortalNav } from '@/components/seller/portal-nav';
import { Link, redirect } from '@/i18n/navigation';
import { getMe } from '@/server/api';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The seller portal shell. Redirecting anonymous visitors is a convenience;
 * the API checks the session and store permissions on every request regardless.
 */
export default async function SellerPortalLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await getMe();
  if (!me) redirect({ href: '/seller/login', locale });
  const t = await getTranslations('seller');
  const nav = await getTranslations('nav');

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[220px_1fr]">
      <aside className="border-b border-line bg-surface md:min-h-dvh md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-4 py-3 md:px-5 md:py-5">
          <Link href="/seller/dashboard" className="text-lg">
            <Logo suffix="seller" />
          </Link>
          <div className="flex items-center gap-3 md:hidden">
            <LanguageLink className="text-[12px] font-semibold text-muted">
              {nav('languageShort')}
            </LanguageLink>
            <LogoutButton />
          </div>
        </div>
        <div className="px-2 pb-2 md:px-3">
          <PortalNav />
        </div>
        <div className="hidden gap-2 px-5 py-4 text-[13px] text-muted md:grid">
          <span className="truncate">{me!.user.name}</span>
          <div className="flex items-center gap-3">
            <LanguageLink className="text-muted hover:text-ink">
              {nav('languageShort')}
            </LanguageLink>
            <LogoutButton />
          </div>
        </div>
        <span className="sr-only">{t('portal')}</span>
      </aside>
      <main className="min-w-0 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
