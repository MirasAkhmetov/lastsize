import { Pill } from '@lastsize/ui';
import type { Metadata } from 'next';
import { PhoneBlockForm, PhoneUnblock } from '@/components/phone-actions';
import { formatDateTime } from '@/components/order-labels';
import { getBlockedPhones, getSuspiciousPhones } from '@/server/api';

export const metadata: Metadata = { title: 'Номера' };

export default async function PhonesPage() {
  const [suspicious, blocked] = await Promise.all([getSuspiciousPhones(), getBlockedPhones()]);
  return (
    <div className="grid max-w-4xl gap-6">
      <h1 className="text-2xl font-bold">Номера покупателей</h1>
      <p className="max-w-2xl text-[13.5px] text-muted">
        Без SMS номер покупателя не проверяется. Сюда попадают номера, с которыми у магазинов не
        вышло три и больше заказов за 90 дней: не дозвонились, покупатель отказался или не забрал.
        Заблокированный номер не может оформить заказ.
      </p>

      <section className="grid gap-2">
        <h2 className="font-bold">На проверку</h2>
        {suspicious.length === 0 ? (
          <p className="text-[13px] text-muted">Пока таких номеров нет.</p>
        ) : (
          <ul className="grid gap-2">
            {suspicious.map((phone) => (
              <li
                key={phone.phone}
                className="grid gap-2 rounded-xl border border-line bg-surface px-4 py-3 md:grid-cols-[1fr_auto] md:items-center"
              >
                <div>
                  <p className="font-semibold tabular-nums">
                    {phone.phone} {phone.blocked && <Pill tone="sale">заблокирован</Pill>}
                  </p>
                  <p className="text-[12.5px] text-muted">
                    Заказов: {phone.orders} · не дозвонились: {phone.unreachable} · не забрали:{' '}
                    {phone.notPickedUp} · отказался: {phone.refused} · последний{' '}
                    {formatDateTime(phone.lastOrderAt)}
                  </p>
                </div>
                {!phone.blocked && <PhoneBlockForm phone={phone.phone} compact />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-2">
        <h2 className="font-bold">Заблокированные</h2>
        <PhoneBlockForm />
        <ul className="grid gap-2">
          {blocked.map((phone) => (
            <li
              key={phone.phone}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3"
            >
              <div>
                <p className="font-semibold tabular-nums">{phone.phone}</p>
                <p className="text-[12.5px] text-muted">
                  {phone.reason} · {formatDateTime(phone.createdAt)}
                </p>
              </div>
              <PhoneUnblock phone={phone.phone} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
