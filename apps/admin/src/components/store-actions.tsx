'use client';

import { ApiError, apiRequest, type StoreStatus } from '@lastsize/contracts';
import { Button, Dialog, TextAreaField, useToast } from '@lastsize/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Action = 'verify' | 'reject' | 'block' | 'unblock';

const COPY: Record<
  Action,
  { button: string; title: string; description: string; confirm: string; done: string }
> = {
  verify: {
    button: 'Подтвердить магазин',
    title: 'Подтвердить магазин?',
    description: 'Магазин сможет публиковать товары. Номер владельца станет подтверждённым.',
    confirm: 'Подтвердить',
    done: 'Магазин подтверждён',
  },
  reject: {
    button: 'Отклонить',
    title: 'Отклонить заявку',
    description: 'Продавец увидит причину и сможет исправить данные.',
    confirm: 'Отклонить',
    done: 'Заявка отклонена',
  },
  block: {
    button: 'Заблокировать',
    title: 'Заблокировать магазин',
    description: 'Продавец сразу потеряет доступ к кабинету магазина, товары будут скрыты.',
    confirm: 'Заблокировать',
    done: 'Магазин заблокирован',
  },
  unblock: {
    button: 'Разблокировать',
    title: 'Разблокировать магазин?',
    description: 'Магазин вернётся в статус, который был до блокировки.',
    confirm: 'Разблокировать',
    done: 'Магазин разблокирован',
  },
};

const REJECT_PRESETS = [
  'БИН/ИИН не найден в реестре или принадлежит другой компании',
  'Не удалось дозвониться до владельца',
  'Адрес магазина не подтвердился',
  'Магазин продаёт товары, запрещённые на площадке',
];

function actionsFor(status: StoreStatus): Action[] {
  switch (status) {
    case 'PENDING_VERIFICATION':
      return ['verify', 'reject', 'block'];
    case 'VERIFIED':
    case 'REJECTED':
      return ['block'];
    case 'BLOCKED':
      return ['unblock'];
  }
}

export function StoreActions({
  storeId,
  status,
  ownerPhone,
}: {
  storeId: string;
  status: StoreStatus;
  ownerPhone: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [called, setCalled] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsReason = open === 'reject' || open === 'block';
  const canConfirm = open === 'verify' ? called : needsReason ? reason.trim().length >= 5 : true;

  function close() {
    setOpen(null);
    setReason('');
    setCalled(false);
    setError(null);
  }

  async function confirm() {
    if (!open) return;
    setPending(true);
    setError(null);
    try {
      const body =
        open === 'verify'
          ? { phoneConfirmed: true }
          : needsReason
            ? { reason: reason.trim() }
            : undefined;
      await apiRequest('POST', `/admin/stores/${storeId}/${open}`, body);
      toast({ title: COPY[open].done });
      close();
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (caught.problem?.detail ?? 'Не получилось')
          : 'Нет соединения с сервером',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {actionsFor(status).map((action) => (
          <Button
            key={action}
            variant={action === 'verify' || action === 'unblock' ? 'primary' : 'ghost'}
            onClick={() => setOpen(action)}
          >
            {COPY[action].button}
          </Button>
        ))}
      </div>
      <Dialog
        open={open !== null}
        onOpenChange={(next) => !next && close()}
        title={open ? COPY[open].title : ''}
        description={open ? COPY[open].description : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Отмена
            </Button>
            <Button onClick={confirm} loading={pending} disabled={!canConfirm}>
              {open ? COPY[open].confirm : ''}
            </Button>
          </>
        }
      >
        {open === 'verify' && (
          <label className="flex items-start gap-2 rounded-lg bg-soft p-3 text-[13.5px]">
            <input
              type="checkbox"
              checked={called}
              onChange={(event) => setCalled(event.target.checked)}
              className="mt-0.5 size-4"
            />
            <span>
              Я позвонил по номеру <span className="font-semibold tabular-nums">{ownerPhone}</span>,
              владелец подтвердил заявку, БИН/ИИН сверен с реестром.
            </span>
          </label>
        )}
        {needsReason && (
          <div className="grid gap-2">
            {open === 'reject' && (
              <div className="flex flex-wrap gap-1.5">
                {REJECT_PRESETS.map((preset) => (
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
            )}
            <TextAreaField
              label="Причина (её увидит продавец)"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              hint="Не меньше 5 символов"
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-[13px] text-sale">
            {error}
          </p>
        )}
      </Dialog>
    </>
  );
}
