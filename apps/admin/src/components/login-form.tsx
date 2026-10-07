'use client';

import { ApiError, apiRequest, NetworkError } from '@lastsize/contracts';
import { Button, TextField } from '@lastsize/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

const VALIDATION: Record<string, string> = {
  'phone.invalid': 'Введите казахстанский номер, например +7 701 123 45 67',
  'password.required': 'Введите пароль',
};

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await apiRequest('POST', '/auth/login', {
        phone: data.get('phone'),
        password: data.get('password'),
      });
      router.replace('/mfa');
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) {
        const code = Object.values(caught.fieldErrors())[0];
        setError((code && VALIDATION[code]) ?? 'Проверьте номер и пароль');
      } else if (caught instanceof ApiError && caught.status === 429) {
        setError(
          `Слишком много попыток. Повторите через ${Math.ceil((caught.retryAfterSeconds ?? 60) / 60)} мин.`,
        );
      } else if (caught instanceof ApiError) {
        setError(caught.problem?.detail ?? 'Не удалось войти');
      } else {
        setError(caught instanceof NetworkError ? 'Нет соединения с сервером' : 'Не удалось войти');
      }
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <TextField
        label="Телефон"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="username"
        required
      />
      <TextField
        label="Пароль"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      {error && (
        <p role="alert" className="rounded-lg bg-sale-soft px-3 py-2 text-[13px] text-sale">
          {error}
        </p>
      )}
      <Button type="submit" block loading={pending}>
        Войти
      </Button>
    </form>
  );
}
