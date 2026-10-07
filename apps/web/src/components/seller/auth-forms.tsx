'use client';

import { Button, TextField } from '@lastsize/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { ApiError, apiRequest, NetworkError } from '@lastsize/contracts';

type Mode = 'login' | 'join';

/** Seller sign-in and sign-up. The API sets an HttpOnly session cookie; nothing is stored in JS. */
export function SellerAuthForm({ mode }: { mode: Mode }) {
  const t = useTranslations('seller');
  const errors = useTranslations('errors');
  const validation = useTranslations('validation');
  /** API validation messages are codes such as "password.tooShort". */
  const translateField = (code: string) =>
    validation.has(code) ? validation(code) : validation('generic');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body =
      mode === 'join'
        ? {
            name: String(data.get('name') ?? ''),
            phone: String(data.get('phone') ?? ''),
            password: String(data.get('password') ?? ''),
          }
        : { phone: String(data.get('phone') ?? ''), password: String(data.get('password') ?? '') };
    setPending(true);
    setFormError(null);
    setFieldErrors({});
    try {
      await apiRequest('POST', mode === 'join' ? '/auth/register' : '/auth/login', body);
      router.replace('/seller/dashboard');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 429) {
          setFormError(
            errors('rateLimited', {
              minutes: Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60)),
            }),
          );
        } else if (error.status === 422) {
          setFieldErrors(
            Object.fromEntries(
              Object.entries(error.fieldErrors()).map(([field, code]) => [
                field,
                translateField(code),
              ]),
            ),
          );
        } else {
          setFormError(error.problem?.detail ?? errors('generic'));
        }
      } else {
        setFormError(error instanceof NetworkError ? errors('network') : errors('generic'));
      }
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      {mode === 'join' && (
        <TextField
          label={t('name')}
          name="name"
          autoComplete="name"
          required
          minLength={2}
          maxLength={100}
          error={fieldErrors.name}
        />
      )}
      <TextField
        label={t('phone')}
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required
        hint={t('phoneHint')}
        error={fieldErrors.phone}
      />
      <TextField
        label={t('password')}
        name="password"
        type="password"
        autoComplete={mode === 'join' ? 'new-password' : 'current-password'}
        required
        minLength={mode === 'join' ? 10 : 1}
        maxLength={128}
        hint={mode === 'join' ? t('passwordHint') : undefined}
        error={fieldErrors.password}
      />
      {formError && (
        <p role="alert" className="rounded-lg bg-sale-soft px-3 py-2 text-[13px] text-sale">
          {formError}
        </p>
      )}
      <Button type="submit" block loading={pending}>
        {mode === 'join' ? t('submitJoin') : t('submitLogin')}
      </Button>
    </form>
  );
}

export function LogoutButton() {
  const t = useTranslations('seller');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="text"
      size="sm"
      loading={pending}
      onClick={async () => {
        setPending(true);
        await apiRequest('POST', '/auth/logout').catch(() => undefined);
        router.replace('/seller/login');
        router.refresh();
      }}
    >
      {t('logout')}
    </Button>
  );
}
