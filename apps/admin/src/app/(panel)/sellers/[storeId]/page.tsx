import { WEEKDAYS } from '@lastsize/contracts';
import { Pill } from '@lastsize/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StoreActions } from '@/components/store-actions';
import {
  dateTime,
  STORE_ACTION_LABEL,
  STORE_STATUS_LABEL,
  STORE_STATUS_TONE,
} from '@/components/store-labels';
import { getStore } from '@/server/api';

export const metadata: Metadata = { title: 'Магазин' };

const DAY_LABEL: Record<string, string> = {
  mon: 'Пн',
  tue: 'Вт',
  wed: 'Ср',
  thu: 'Чт',
  fri: 'Пт',
  sat: 'Сб',
  sun: 'Вс',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2.5 md:grid-cols-[180px_1fr] md:gap-4">
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="min-w-0 text-[14px] break-words">{children}</dd>
    </div>
  );
}

export default async function StorePage({ params }: { params: Promise<{ storeId: string }> }) {
  const store = await getStore((await params).storeId);
  if (!store) notFound();

  return (
    <div className="grid max-w-4xl gap-6">
      <Link
        href={`/sellers?status=${store.status}`}
        className="text-[13px] text-muted hover:text-ink"
      >
        ← Продавцы
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{store.name}</h1>
        <Pill tone={STORE_STATUS_TONE[store.status]}>{STORE_STATUS_LABEL[store.status]}</Pill>
      </div>
      {store.statusReason && (
        <p className="rounded-lg bg-sale-soft px-3 py-2 text-[13.5px] text-sale">
          <span className="font-semibold">Причина:</span> {store.statusReason}
        </p>
      )}
      <StoreActions storeId={store.id} status={store.status} ownerPhone={store.owner.phone} />

      <section className="rounded-xl border border-line bg-surface px-4">
        <dl className="divide-y divide-line">
          <Row label="Владелец">
            {store.owner.name} ·{' '}
            <span className="tabular-nums select-all">{store.owner.phone}</span>{' '}
            {store.owner.phoneVerified ? (
              <Pill tone="ok">номер подтверждён</Pill>
            ) : (
              <Pill tone="warn">номер не подтверждён</Pill>
            )}
          </Row>
          <Row label="БИН / ИИН">
            <span className="font-mono tabular-nums select-all">{store.binIin}</span>
          </Row>
          <Row label="Юр. название">{store.legalName ?? '—'}</Row>
          <Row label="Адрес">
            {store.location.cityName.ru}, {store.location.address}
          </Row>
          <Row label="Телефон магазина">
            <span className="tabular-nums select-all">{store.location.phone}</span>
          </Row>
          <Row label="Самовывоз">{store.location.pickupEnabled ? 'Да' : 'Нет'}</Row>
          <Row label="График">
            <span className="grid gap-0.5 tabular-nums">
              {WEEKDAYS.map((day) => {
                const intervals = store.location.schedule[day] ?? [];
                return (
                  <span key={day}>
                    {DAY_LABEL[day]}:{' '}
                    {intervals.length
                      ? intervals.map(([from, to]) => `${from}–${to}`).join(', ')
                      : 'выходной'}
                  </span>
                );
              })}
            </span>
          </Row>
          <Row label="Instagram">{store.instagram ? `@${store.instagram}` : '—'}</Row>
          <Row label="Описание">{store.description ?? '—'}</Row>
          <Row label="Адрес на сайте">/store/{store.slug}</Row>
          <Row label="Заявка">{dateTime.format(new Date(store.createdAt))}</Row>
        </dl>
      </section>

      <section className="grid gap-3">
        <h2 className="font-bold">История</h2>
        <ol className="grid gap-2">
          {store.history.map((entry, index) => (
            <li
              key={`${entry.createdAt}-${index}`}
              className="grid gap-0.5 rounded-lg border border-line bg-surface px-4 py-2.5 text-[13.5px]"
            >
              <span>
                <span className="font-semibold">
                  {STORE_ACTION_LABEL[entry.action] ?? entry.action}
                </span>
                {entry.actorName && <span className="text-muted"> · {entry.actorName}</span>}
              </span>
              {entry.reason && <span className="text-muted">Причина: {entry.reason}</span>}
              <span className="text-[12px] text-muted tabular-nums">
                {dateTime.format(new Date(entry.createdAt))}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
