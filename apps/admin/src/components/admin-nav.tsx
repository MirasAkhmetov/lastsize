'use client';

import { cn } from '@lastsize/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { label: 'Обзор', href: '/', ready: true },
  { label: 'Продавцы', href: '/sellers', ready: true },
  { label: 'Лента товаров', href: '/products', ready: false },
  { label: 'Заказы', href: '/orders', ready: false },
  { label: 'Пользователи', href: '/users', ready: true },
  { label: 'Категории', href: '/categories', ready: false },
  { label: 'Аудит', href: '/audit', ready: false },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Разделы админки" className="flex gap-1 overflow-x-auto md:grid md:gap-0.5">
      {ITEMS.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        const classes = cn(
          'flex items-center justify-between gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-[13.5px]',
          active ? 'bg-soft font-semibold text-ink' : 'text-muted',
        );
        return item.ready ? (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(classes, 'hover:text-ink')}
          >
            {item.label}
          </Link>
        ) : (
          <span
            key={item.href}
            aria-disabled
            className={cn(classes, 'cursor-not-allowed opacity-60')}
          >
            {item.label}
            <span className="rounded-full bg-soft px-1.5 text-[10px]">скоро</span>
          </span>
        );
      })}
    </nav>
  );
}
