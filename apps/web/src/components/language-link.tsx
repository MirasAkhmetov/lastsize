'use client';

import { useLocale } from 'next-intl';
import type { ReactNode } from 'react';
import { Link, usePathname } from '@/i18n/navigation';

/** Switches between Russian and Kazakh on the same page. */
export function LanguageLink({ className, children }: { className?: string; children: ReactNode }) {
  const locale = useLocale();
  const pathname = usePathname();
  const target = locale === 'kk' ? 'ru' : 'kk';
  return (
    <Link href={pathname} locale={target} hrefLang={target} className={className}>
      {children}
    </Link>
  );
}
