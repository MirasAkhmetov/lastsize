'use client';

import { cn } from '@lastsize/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useToast } from '@lastsize/ui';
import { useUnreadCount } from './use-notifications';

/** Unread count badge; for stores it also listens live and pops a toast on news. */
export function UnreadBadge({
  base,
  live = false,
  className,
}: {
  base: string;
  live?: boolean;
  className?: string;
}) {
  const t = useTranslations('notifications');
  const router = useRouter();
  const toast = useToast();
  const count = useUnreadCount(base, {
    live,
    onLive: () => {
      toast({ title: t('live') });
      // New orders and statuses show up on the open page without a reload.
      router.refresh();
    },
  });
  if (count === 0) return null;
  return (
    <span
      className={cn(
        'min-w-[18px] rounded-full bg-sale px-1 text-center text-[10.5px] leading-[18px] font-bold text-on-sale tabular-nums',
        className,
      )}
      aria-label={t('unread', { count })}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
