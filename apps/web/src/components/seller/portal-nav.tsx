'use client';

import { cn } from '@lastsize/ui';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { UnreadBadge } from '../notifications/bell';

const ITEMS = [
  { key: 'navOverview', href: '/seller/dashboard', ready: true },
  { key: 'navOrders', href: '/seller/orders', ready: true },
  { key: 'navProducts', href: '/seller/products', ready: true },
  { key: 'navInventory', href: '/seller/inventory', ready: false },
  { key: 'navImport', href: '/seller/import', ready: true },
  { key: 'navNotifications', href: '/seller/notifications', ready: true },
  { key: 'navStore', href: '/seller/store', ready: true },
] as const;

/** Sidebar on desktop, horizontal scroller on phones. Sections not built yet are shown but disabled. */
export function PortalNav({ newOrders = 0, storeId }: { newOrders?: number; storeId?: string }) {
  const t = useTranslations('seller');
  const pathname = usePathname();
  return (
    <nav
      aria-label={t('portal')}
      className="flex gap-1 overflow-x-auto md:grid md:content-start md:gap-0.5"
    >
      {ITEMS.map((item) => {
        const active = pathname.startsWith(item.href);
        const classes = cn(
          'flex items-center justify-between gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-[13.5px]',
          active ? 'bg-soft font-semibold text-ink' : 'text-muted',
        );
        return item.ready ? (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(classes, 'hover:text-ink')}
          >
            {t(item.key)}
            {item.key === 'navNotifications' && storeId && (
              <UnreadBadge base={`/seller/stores/${storeId}/notifications`} live />
            )}
            {item.key === 'navOrders' && newOrders > 0 && (
              <span className="min-w-5 rounded-full bg-sale px-1.5 text-center text-[11px] font-bold text-on-sale tabular-nums">
                {newOrders}
              </span>
            )}
          </Link>
        ) : (
          <span
            key={item.key}
            aria-disabled
            className={cn(classes, 'cursor-not-allowed opacity-60')}
          >
            {t(item.key)}
            <span className="rounded-full bg-soft px-1.5 text-[10px]">{t('soon')}</span>
          </span>
        );
      })}
    </nav>
  );
}
