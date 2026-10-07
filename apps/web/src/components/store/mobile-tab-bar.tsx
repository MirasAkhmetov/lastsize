'use client';

import { cn } from '@lastsize/ui';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { BagIcon, GridIcon, HeartIcon, HomeIcon, UserIcon } from '../icons';

const TABS = [
  { key: 'home', href: '/', icon: HomeIcon },
  { key: 'catalog', href: '/catalog', icon: GridIcon },
  { key: 'favorites', href: '/favorites', icon: HeartIcon },
  { key: 'cart', href: '/cart', icon: BagIcon },
  { key: 'profile', href: '/account', icon: UserIcon },
] as const;

/** Bottom navigation on phones, where most buyers come from. */
export function MobileTabBar() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  return (
    <nav
      aria-label={t('mainNavigation')}
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface pt-1.5 pb-[calc(env(safe-area-inset-bottom)+8px)] text-[10.5px] md:hidden"
    >
      {TABS.map(({ key, href, icon: TabIcon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'grid justify-items-center gap-0.5',
              active ? 'font-semibold text-ink' : 'text-muted',
            )}
          >
            <TabIcon width={22} height={22} />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
