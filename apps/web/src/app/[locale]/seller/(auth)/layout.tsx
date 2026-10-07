import { Logo } from '@lastsize/ui';
import { setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Link, redirect } from '@/i18n/navigation';
import { getMe } from '@/server/api';

export default async function SellerAuthLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Already signed in: go straight to the portal.
  if (await getMe()) redirect({ href: '/seller/dashboard', locale });
  return (
    <div className="grid min-h-dvh place-items-start justify-center px-4 pt-12 md:place-items-center md:pt-0">
      <div className="grid w-full max-w-sm gap-6">
        <Link href="/seller" className="text-xl">
          <Logo />
        </Link>
        {children}
      </div>
    </div>
  );
}
