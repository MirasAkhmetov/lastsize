import type { PillTone } from '@lastsize/ui';

export const ORDER_STATUS: Record<string, { label: string; tone: PillTone }> = {
  NEW: { label: 'Ждёт подтверждения', tone: 'warn' },
  CONFIRMED: { label: 'Подтверждён', tone: 'info' },
  READY_FOR_PICKUP: { label: 'Готов к выдаче', tone: 'info' },
  COURIER_REQUESTED: { label: 'Вызван курьер', tone: 'info' },
  HANDED_TO_COURIER: { label: 'У курьера', tone: 'info' },
  COMPLETED: { label: 'Выполнен', tone: 'ok' },
  CANCELLED: { label: 'Отменён', tone: 'muted' },
};

export const CANCEL_REASON: Record<string, string> = {
  'customer.cancelled': 'Отменил покупатель',
  'system.notConfirmed': 'Магазин не подтвердил за 24 ч',
  'system.notPickedUp': 'Не забрали за 48 ч',
  'store.outOfStock': 'Магазин: нет в наличии',
  'store.customerUnreachable': 'Магазин: не дозвонились',
  'store.customerRefused': 'Магазин: покупатель отказался',
  'store.other': 'Магазин: другая причина',
  'admin.cancelled': 'Отменила поддержка',
};

const dateTime = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Almaty',
});
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const percent = (rate: number) => `${Math.round(rate * 1000) / 10}%`;
