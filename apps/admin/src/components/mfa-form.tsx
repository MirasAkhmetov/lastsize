'use client';

import { ApiError, apiRequest, type MfaSetupResponse } from '@lastsize/contracts';
import { Button, TextField } from '@lastsize/ui';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { type FormEvent, useState } from 'react';

/** First sign-in: enrol the authenticator app. Later sign-ins: enter the current code. */
export function MfaForm({ enrolled }: { enrolled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<(MfaSetupResponse & { qr: string }) | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startSetup() {
    setPending(true);
    setError(null);
    try {
      const response = await apiRequest<MfaSetupResponse>('POST', '/auth/mfa/setup');
      const qr = await QRCode.toDataURL(response.otpauthUri, { margin: 1, width: 220 });
      setSetup({ ...response, qr });
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (caught.problem?.detail ?? 'Не удалось начать подключение')
          : 'Нет соединения с сервером',
      );
    } finally {
      setPending(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') ?? '').replace(/\s/g, '');
    setPending(true);
    setError(null);
    try {
      await apiRequest('POST', enrolled ? '/auth/mfa/verify' : '/auth/mfa/activate', { code });
      router.replace('/');
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422)
        setError('Введите 6 цифр из приложения');
      else if (caught instanceof ApiError && caught.status === 429)
        setError('Слишком много неверных кодов. Подождите 15 минут.');
      else if (caught instanceof ApiError) setError(caught.problem?.detail ?? 'Код не подошёл');
      else setError('Нет соединения с сервером');
      setPending(false);
    }
  }

  if (!enrolled && !setup) {
    return (
      <div className="grid gap-4">
        <p className="text-[14px] text-muted">
          Для входа в админку нужен код из приложения-аутентификатора (Google Authenticator,
          1Password, Яндекс Ключ). Подключение занимает минуту.
        </p>
        {error && (
          <p role="alert" className="text-[13px] text-sale">
            {error}
          </p>
        )}
        <Button onClick={startSetup} loading={pending}>
          Подключить приложение
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      {setup && (
        <div className="grid justify-items-center gap-3 rounded-xl border border-line bg-surface p-4">
          <img
            src={setup.qr}
            alt="QR-код для приложения-аутентификатора"
            width={220}
            height={220}
            className="rounded bg-white p-1"
          />
          <p className="text-center text-[12.5px] text-muted">
            Отсканируйте код в приложении или введите ключ вручную:
            <code className="mt-1 block font-mono text-[12px] break-all text-ink select-all">
              {setup.secret}
            </code>
          </p>
        </div>
      )}
      <TextField
        label="Код из приложения"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={7}
        required
        autoFocus
      />
      {error && (
        <p role="alert" className="rounded-lg bg-sale-soft px-3 py-2 text-[13px] text-sale">
          {error}
        </p>
      )}
      <Button type="submit" block loading={pending}>
        Подтвердить
      </Button>
    </form>
  );
}
