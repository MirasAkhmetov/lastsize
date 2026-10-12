'use client';

import { apiRequest, type NotificationList } from '@lastsize/contracts';
import { useLocale } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

const EVENT = 'lastsize:notifications';
/** Buyers have no live stream; the count is refreshed this often and when the tab is shown. */
const POLL_MS = 60_000;

/** Tell the other badges on the page that the unread count changed. */
export function announceUnread(count: number): void {
  window.dispatchEvent(new CustomEvent<number>(EVENT, { detail: count }));
}

/**
 * Unread count of a notification feed ('/customer/notifications' or a store's), kept fresh:
 * stores get server-sent events, everyone gets polling as a fallback.
 */
export function useUnreadCount(
  base: string,
  options: { live?: boolean; onLive?: () => void } = {},
): number {
  const lang = useLocale() === 'kk' ? 'kk' : 'ru';
  const [count, setCount] = useState(0);
  const onLive = useRef(options.onLive);
  onLive.current = options.onLive;

  const refresh = useCallback(async () => {
    try {
      const result = await apiRequest<NotificationList>('GET', `${base}?lang=${lang}`);
      setCount((previous) => {
        // Other badges and an open list catch up too.
        if (previous !== result.unread) queueMicrotask(() => announceUnread(result.unread));
        return result.unread;
      });
    } catch {
      // Offline or signed out: keep the last value.
    }
  }, [base, lang]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    const onAnnounce = (event: Event) => setCount((event as CustomEvent<number>).detail);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(EVENT, onAnnounce);
    let source: EventSource | null = null;
    if (options.live && typeof EventSource !== 'undefined') {
      source = new EventSource(`/api/v1${base}/stream`);
      source.addEventListener('notification', () => {
        void refresh();
        onLive.current?.();
      });
    }
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(EVENT, onAnnounce);
      source?.close();
    };
  }, [base, options.live, refresh]);

  return count;
}
