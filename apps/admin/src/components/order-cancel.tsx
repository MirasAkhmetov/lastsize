'use client';

import { ApiError, apiRequest } from '@lastsize/contracts';
import { Button, Notice, TextAreaField, useToast } from '@lastsize/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Support cancels an order (dispute or fraud): stock is released, both sides are told. */
export function OrderCancel({ orderId }: { orderId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (!window.confirm('Отменить заказ? Покупатель и магазин получат уведомление.')) return;
    setPending(true);
    setError(null);
    try {
      await apiRequest('POST', `/admin/orders/${orderId}/cancel`, { note: note.trim() });
      toast({ title: 'Заказ отменён' });
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.status === 422
            ? 'Опишите причину (от 3 символов)'
            : (caught.problem?.detail ?? 'Не получилось')
          : 'Нет соединения с сервером',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="grid gap-2 rounded-xl border border-line bg-surface p-4">
      <h2 className="font-bold">Отменить заказ</h2>
      <TextAreaField
        label="Причина (останется в аудите)"
        rows={2}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={300}
      />
      {error && <Notice>{error}</Notice>}
      <Button
        variant="ghost"
        size="sm"
        className="justify-self-start"
        disabled={pending}
        onClick={() => void cancel()}
      >
        Отменить заказ
      </Button>
    </section>
  );
}
