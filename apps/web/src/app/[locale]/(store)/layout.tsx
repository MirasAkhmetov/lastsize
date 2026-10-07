import { setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { MobileTabBar } from '@/components/store/mobile-tab-bar';
import { SiteFooter } from '@/components/store/site-footer';
import { SiteHeader } from '@/components/store/site-header';

export default async function StoreLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  setRequestLocale((await params).locale);
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 md:px-6">{children}</main>
      <SiteFooter />
      <MobileTabBar />
    </>
  );
}
