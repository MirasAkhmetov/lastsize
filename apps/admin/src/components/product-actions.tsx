'use client';

import { ApiError, apiRequest, type ProductStatus } from '@lastsize/contracts';
import { Button, Dialog, TextAreaField, useToast } from '@lastsize/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const REMOVE_PRESETS = [
  'Цена до скидки завышена: товар продавался дешевле',
  'Подделка известного бренда',
  'Фото не соответствуют товару',
  'Товар запрещён к продаже на площадке',
  'Товар б/у, а площадка принимает только новые',
];

export function ProductActions({
  productId,
  status,
}: {
  productId: string;
  status: ProductStatus;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: 'remove' | 'restore' | 'clear-flag', body?: unknown) {
    setPending(action);
    setError(null);
    try {
      await apiRequest('POST', `/admin/products/${productId}/${action}`, body);
      toast({
        title: {
          remove: 'Товар снят',
          restore: 'Товар возвращён продавцу (скрыт)',
          'clear-flag': 'Флаг снят',
        }[action],
      });
      setOpen(false);
      setReason('');
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (caught.problem?.detail ?? 'Не получилось')
          : 'Нет соединения с сервером',
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {status === 'FLAGGED' && (
        <Button
          size="sm"
          variant="ghost"
          loading={pending === 'clear-flag'}
          onClick={() => run('clear-flag')}
        >
          Всё в порядке
        </Button>
      )}
      {status !== 'REMOVED' && status !== 'ARCHIVED' && (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          Снять…
        </Button>
      )}
      {status === 'REMOVED' && (
        <Button
          size="sm"
          variant="ghost"
          loading={pending === 'restore'}
          onClick={() => run('restore')}
        >
          Вернуть продавцу
        </Button>
      )}
      {error && !open && <span className="text-[12px] text-sale">{error}</span>}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Снять товар с продажи"
        description="Товар сразу пропадёт из каталога. Продавец увидит причину и не сможет опубликовать товар без вашего решения."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button
              loading={pending === 'remove'}
              disabled={reason.trim().length < 5}
              onClick={() => run('remove', { reason: reason.trim() })}
            >
              Снять
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap gap-1.5">
          {REMOVE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setReason(preset)}
              className="rounded-full border border-line px-2.5 py-1 text-left text-[12px] hover:border-ink"
            >
              {preset}
            </button>
          ))}
        </div>
        <TextAreaField
          label="Причина (её увидит продавец)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          maxLength={500}
        />
        {error && (
          <p role="alert" className="text-[13px] text-sale">
            {error}
          </p>
        )}
      </Dialog>
    </div>
  );
}
