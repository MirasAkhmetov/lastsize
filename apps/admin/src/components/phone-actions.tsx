'use client';

import { ApiError, apiRequest } from '@lastsize/contracts';
import { Button, TextField, useToast } from '@lastsize/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

export function PhoneBlockForm({ phone, compact = false }: { phone?: string; compact?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await apiRequest('POST', '/admin/phones/blocked', {
        phone: phone ?? String(data.get('phone') ?? '').trim(),
        reason: String(data.get('reason') ?? '').trim(),
      });
      toast({ title: 'Номер заблокирован' });
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 422
          ? 'Проверьте номер и причину (от 3 символов)'
          : 'Не получилось',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className={
        compact
          ? 'flex flex-wrap items-end gap-2'
          : 'grid gap-2 rounded-xl border border-line bg-surface p-4 md:grid-cols-[200px_1fr_auto] md:items-end'
      }
      noValidate
    >
      {!phone && (
        <TextField
          label="Телефон"
          name="phone"
          type="tel"
          placeholder="+7 7xx xxx xx xx"
          required
        />
      )}
      <TextField
        label="Причина"
        name="reason"
        defaultValue={phone ? 'Фейковые заказы: магазины не дозвонились' : ''}
        required
      />
      <Button type="submit" size="sm" disabled={pending}>
        Заблокировать
      </Button>
      {error && <p className="text-xs text-sale md:col-span-3">{error}</p>}
    </form>
  );
}

export function PhoneUnblock({ phone }: { phone: string }) {
  const router = useRouter();
  const toast = useToast();
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        await apiRequest('DELETE', `/admin/phones/blocked/${encodeURIComponent(phone)}`).catch(
          () => undefined,
        );
        toast({ title: 'Номер разблокирован' });
        router.refresh();
      }}
    >
      Разблокировать
    </Button>
  );
}
