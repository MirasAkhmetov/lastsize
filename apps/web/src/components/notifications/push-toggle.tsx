'use client';

import { ApiError, apiRequest } from '@lastsize/contracts';
import { Button, Notice } from '@lastsize/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

type State = 'loading' | 'unavailable' | 'unsupported' | 'denied' | 'off' | 'on';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Browser notifications for this device. Works on https (and localhost); before the domain is
 * bought the server has no VAPID keys and the switch explains that.
 */
export function PushToggle() {
  const t = useTranslations('notifications');
  const [state, setState] = useState<State>('loading');
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      if (
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      )
        return setState('unsupported');
      const config = await apiRequest<{ publicKey: string | null }>('GET', '/push/config').catch(
        () => ({ publicKey: null }),
      );
      if (!config.publicKey) return setState('unavailable');
      setKey(config.publicKey);
      if (Notification.permission === 'denied') return setState('denied');
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      setState(subscription ? 'on' : 'off');
    })();
  }, []);

  async function enable() {
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return setState('denied');
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key!),
      });
      const json = subscription.toJSON();
      await apiRequest('POST', '/push/subscriptions', { endpoint: json.endpoint, keys: json.keys });
      setState('on');
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? (cause.problem?.detail ?? t('pushUnsupported'))
          : t('pushUnsupported'),
      );
    }
  }

  async function disable() {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await apiRequest('DELETE', '/push/subscriptions', { endpoint: subscription.endpoint }).catch(
        () => undefined,
      );
      await subscription.unsubscribe();
    }
    setState('off');
  }

  return (
    <section className="grid gap-2 rounded-2xl border border-line bg-surface p-4">
      <h3 className="font-bold">{t('pushTitle')}</h3>
      <p className="text-[13px] text-muted">{t('pushText')}</p>
      {state === 'unavailable' && <p className="text-[13px] text-muted">{t('pushUnavailable')}</p>}
      {state === 'unsupported' && <p className="text-[13px] text-muted">{t('pushUnsupported')}</p>}
      {state === 'denied' && <Notice>{t('pushDenied')}</Notice>}
      {state === 'off' && (
        <Button size="sm" className="justify-self-start" onClick={() => void enable()}>
          {t('pushEnable')}
        </Button>
      )}
      {state === 'on' && (
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-semibold text-ok">{t('pushOn')}</span>
          <Button size="sm" variant="ghost" onClick={() => void disable()}>
            {t('pushDisable')}
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-sale">{error}</p>}
    </section>
  );
}
