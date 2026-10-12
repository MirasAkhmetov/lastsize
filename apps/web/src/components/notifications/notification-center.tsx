'use client';

import { apiRequest, type Notification, type NotificationList } from '@lastsize/contracts';
import { Button, cn, EmptyState, Skeleton } from '@lastsize/ui';
import { useFormatter, useLocale, useNow, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { announceUnread } from './use-notifications';

/** The list of notifications of a buyer or a store; opening one marks it read. */
export function NotificationCenter({ base, emptyText }: { base: string; emptyText: string }) {
  const t = useTranslations('notifications');
  const lang = useLocale() === 'kk' ? 'kk' : 'ru';
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [more, setMore] = useState(false);

  const load = useCallback(
    async (before?: string) => {
      const query = new URLSearchParams({ lang, ...(before ? { before } : {}) });
      const page = await apiRequest<NotificationList>('GET', `${base}?${query}`);
      setItems((current) => (before ? [...(current ?? []), ...page.items] : page.items));
      setUnread(page.unread);
      setMore(page.items.length === 30);
    },
    [base, lang],
  );

  useEffect(() => {
    void load().catch(() => setItems([]));
    // New ones arrive while the page is open (the badge hook announces them).
    const onAnnounce = () => void load().catch(() => undefined);
    window.addEventListener('lastsize:notifications', onAnnounce);
    return () => window.removeEventListener('lastsize:notifications', onAnnounce);
  }, [load]);

  async function markRead(ids: string[] | 'all') {
    await apiRequest('POST', `${base}/read`, ids === 'all' ? { all: true } : { ids }).catch(
      () => undefined,
    );
    setItems((current) =>
      (current ?? []).map((item) =>
        ids === 'all' || ids.includes(item.id) ? { ...item, read: true } : item,
      ),
    );
    const next = ids === 'all' ? 0 : Math.max(0, unread - ids.length);
    setUnread(next);
    announceUnread(next);
  }

  if (items === null) return <Skeleton className="h-40" />;
  if (items.length === 0) return <EmptyState title={t('empty')} description={emptyText} />;

  return (
    <div className="grid gap-3">
      {unread > 0 && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-muted">{t('unread', { count: unread })}</span>
          <Button size="sm" variant="ghost" onClick={() => void markRead('all')}>
            {t('markAll')}
          </Button>
        </div>
      )}
      <ul className="grid gap-2">
        {items.map((item) => {
          const content = (
            <>
              <div className="flex items-start justify-between gap-3">
                <p className={cn('text-[14px]', !item.read && 'font-bold')}>
                  {!item.read && (
                    <span
                      aria-hidden
                      className="mr-2 inline-block size-2 rounded-full bg-sale align-middle"
                    />
                  )}
                  {item.title}
                </p>
                <time dateTime={item.createdAt} className="shrink-0 text-[12px] text-muted">
                  {format.relativeTime(
                    new Date(Math.min(Date.parse(item.createdAt), now.getTime())),
                    now,
                  )}
                </time>
              </div>
              {item.body && <p className="text-[13px] text-muted">{item.body}</p>}
            </>
          );
          const classes = cn(
            'grid gap-1 rounded-xl border px-4 py-3',
            item.read ? 'border-line bg-surface' : 'border-ink bg-surface',
          );
          return (
            <li key={item.id}>
              {item.link ? (
                <Link
                  href={item.link}
                  className={cn(classes, 'hover:border-ink')}
                  onClick={() => !item.read && void markRead([item.id])}
                >
                  {content}
                </Link>
              ) : (
                <div className={classes}>{content}</div>
              )}
            </li>
          );
        })}
      </ul>
      {more && (
        <Button
          size="sm"
          variant="ghost"
          className="justify-self-center"
          onClick={() => void load(items.at(-1)?.id)}
        >
          {t('more')}
        </Button>
      )}
    </div>
  );
}
