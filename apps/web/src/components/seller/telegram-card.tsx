'use client';

import { apiRequest } from '@lastsize/contracts';
import { Button, Notice } from '@lastsize/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

/** Links the seller's Telegram for instant order alerts. */
export function TelegramCard() {
  const t = useTranslations('notifications');
  const [status, setStatus] = useState<{ available: boolean; linked: boolean } | null>(null);
  const [opened, setOpened] = useState(false);

  const load = () =>
    apiRequest<{ available: boolean; linked: boolean }>('GET', '/seller/telegram')
      .then(setStatus)
      .catch(() => setStatus({ available: false, linked: false }));
  useEffect(() => {
    void load();
    // Back from Telegram: show the new state.
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  async function connect() {
    const { url } = await apiRequest<{ url: string }>('POST', '/seller/telegram/link');
    window.open(url, '_blank', 'noopener,noreferrer');
    setOpened(true);
  }

  async function disconnect() {
    await apiRequest('DELETE', '/seller/telegram');
    await load();
  }

  return (
    <section className="grid gap-2 rounded-2xl border border-line bg-surface p-4">
      <h3 className="font-bold">{t('telegramTitle')}</h3>
      <p className="text-[13px] text-muted">{t('telegramText')}</p>
      {status && !status.available && (
        <p className="text-[13px] text-muted">{t('telegramUnavailable')}</p>
      )}
      {status?.available && status.linked && (
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-semibold text-ok">{t('telegramConnected')}</span>
          <Button size="sm" variant="ghost" onClick={() => void disconnect()}>
            {t('telegramDisconnect')}
          </Button>
        </div>
      )}
      {status?.available && !status.linked && (
        <Button size="sm" className="justify-self-start" onClick={() => void connect()}>
          {t('telegramConnect')}
        </Button>
      )}
      {opened && !status?.linked && <Notice tone="info">{t('telegramOpened')}</Notice>}
    </section>
  );
}
