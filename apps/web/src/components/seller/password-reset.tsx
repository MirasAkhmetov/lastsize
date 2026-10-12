'use client';

import { ApiError, apiRequest, NetworkError } from '@lastsize/contracts';
import { Button, Notice, TextField, useToast } from '@lastsize/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';

/** "Forgot password?": the Telegram bot checks the phone number and sends a reset link. */
export function ForgotPassword() {
  const t = useTranslations('seller');
  const [bot, setBot] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    apiRequest<{ username: string | null }>('GET', '/telegram/bot')
      .then((result) => setBot(result.username))
      .catch(() => setBot(null));
  }, []);
  return (
    <details className="rounded-xl border border-line bg-surface px-4 py-3 text-[13.5px]">
      <summary className="cursor-pointer font-semibold">{t('forgot')}</summary>
      <div className="mt-2 grid gap-2 text-muted">
        {bot ? (
          <>
            <p>{t('forgotText')}</p>
            <a
              href={`https://t.me/${bot}`}
              target="_blank"
              rel="noopener noreferrer"
              className="justify-self-start font-semibold text-ink underline underline-offset-4"
            >
              {t('forgotOpen')}
            </a>
          </>
        ) : bot === null ? (
          <p>{t('forgotNoBot')}</p>
        ) : null}
      </div>
    </details>
  );
}

export function PasswordResetForm({ token }: { token: string | null }) {
  const t = useTranslations('seller');
  const validation = useTranslations('validation');
  const errors = useTranslations('errors');
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  if (!token) return <Notice>{t('resetMissing')}</Notice>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      await apiRequest('POST', '/auth/password-reset', { token, password });
      toast({ title: t('resetDone') });
      router.replace('/seller/login');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 422) {
        const mapped = Object.fromEntries(
          Object.entries(cause.fieldErrors()).map(([path, code]) => [
            path,
            validation.has(code) ? validation(code) : validation('generic'),
          ]),
        );
        setFieldErrors(mapped);
        if (mapped.token) setError(mapped.token);
      } else {
        setError(
          cause instanceof ApiError
            ? (cause.problem?.detail ?? errors('generic'))
            : cause instanceof NetworkError
              ? errors('network')
              : errors('generic'),
        );
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      {error && <Notice>{error}</Notice>}
      <TextField
        label={t('password')}
        name="password"
        type="password"
        autoComplete="new-password"
        hint={t('passwordHint')}
        error={fieldErrors.password}
        required
      />
      <Button type="submit" disabled={pending}>
        {t('resetSubmit')}
      </Button>
    </form>
  );
}
