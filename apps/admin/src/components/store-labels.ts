import type { StoreStatus } from '@lastsize/contracts';
import type { PillTone } from '@lastsize/ui';

export const STORE_STATUS_LABEL: Record<StoreStatus, string> = {
  PENDING_VERIFICATION: 'На проверке',
  VERIFIED: 'Подтверждён',
  REJECTED: 'Отклонён',
  BLOCKED: 'Заблокирован',
};

export const STORE_STATUS_TONE: Record<StoreStatus, PillTone> = {
  PENDING_VERIFICATION: 'warn',
  VERIFIED: 'ok',
  REJECTED: 'sale',
  BLOCKED: 'sale',
};

export const STORE_ACTION_LABEL: Record<string, string> = {
  'store.created': 'Заявка создана',
  'store.updated': 'Продавец изменил данные',
  'store.resubmitted': 'Продавец исправил данные и отправил снова',
  'store.legal_data_changed':
    'Продавец изменил БИН/ИИН или юр. название, магазин вернулся на проверку',
  'store.verified': 'Подтверждён',
  'store.rejected': 'Отклонён',
  'store.blocked': 'Заблокирован',
  'store.unblocked': 'Разблокирован',
};

export const dateTime = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Almaty',
});
