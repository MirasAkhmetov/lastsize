import { formatPrice, Notice, Pill } from '@lastsize/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { percent } from '@/components/order-labels';
import { getAnalytics, getMe, getStores } from '@/server/api';

export const metadata: Metadata = { title: 'Обзор' };

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="grid gap-1 rounded-xl border border-line bg-surface p-4">
      <span className="text-[12px] text-muted">{label}</span>
      <span className={`text-2xl font-bold tabular-nums ${tone === 'warn' ? 'text-warn' : ''}`}>
        {value}
      </span>
    </div>
  );
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const days = [7, 30, 90].includes(Number((await searchParams).days))
    ? Number((await searchParams).days)
    : 30;
  const [me, stores, stats] = await Promise.all([
    getMe(),
    getStores('PENDING_VERIFICATION', 1, 0),
    getAnalytics(days),
  ]);
  const maxWeek = Math.max(1, ...(stats?.weekly.map((week) => week.completed) ?? [1]));
  return (
    <div className="grid max-w-5xl gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Обзор</h1>
        <nav className="flex gap-1.5 text-[13px]" aria-label="Период">
          {[7, 30, 90].map((value) => (
            <Link
              key={value}
              href={`/?days=${value}`}
              className={`rounded-full border px-3 py-1 ${value === days ? 'border-ink bg-ink text-paper' : 'border-line'}`}
            >
              {value} дн.
            </Link>
          ))}
        </nav>
      </div>

      {stats && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Выполнено заказов магазинов" value={String(stats.completed)} />
            <Stat
              label="Оборот (выполненные минус возвраты)"
              value={formatPrice(stats.gmvCompleted)}
            />
            <Stat label="Оформлено заказов" value={String(stats.ordersPlaced)} />
            <Stat
              label="Медиана подтверждения"
              value={
                stats.medianConfirmMinutes === null ? '—' : `${stats.medianConfirmMinutes} мин`
              }
              tone={
                stats.medianConfirmMinutes !== null && stats.medianConfirmMinutes > 30
                  ? 'warn'
                  : undefined
              }
            />
            <Stat label="Отмены" value={percent(stats.cancelRate)} />
            <Stat
              label="Отмены «нет в наличии» (цель < 3%)"
              value={percent(stats.outOfStockRate)}
              tone={stats.outOfStockRate > 0.03 ? 'warn' : undefined}
            />
            <Stat label="Магазины с товарами в продаже" value={String(stats.activeStores)} />
            <Stat label="Товаров в продаже" value={String(stats.activeProducts)} />
          </div>

          <section className="grid gap-2 rounded-xl border border-line bg-surface p-4">
            <h2 className="font-bold">Выполненные заказы по неделям (North Star)</h2>
            <ol className="flex h-36 items-end gap-2" aria-label="Выполненные заказы по неделям">
              {stats.weekly.map((week) => (
                <li
                  key={week.weekStart}
                  className="grid flex-1 justify-items-center gap-1 text-[11px] text-muted"
                >
                  <span className="tabular-nums text-ink">{week.completed}</span>
                  <span
                    className="w-full rounded-t bg-ink"
                    style={{ height: `${Math.max(2, (week.completed / maxWeek) * 96)}px` }}
                  />
                  <span>{week.weekStart.slice(5)}</span>
                </li>
              ))}
            </ol>
          </section>

          {stats.storesToReview.length > 0 && (
            <section className="grid gap-2">
              <h2 className="font-bold">Магазины с частыми отменами (7 дней)</h2>
              <ul className="grid gap-2">
                {stats.storesToReview.map((store) => (
                  <li key={store.storeId}>
                    <Link
                      href={`/sellers/${store.storeId}`}
                      className="flex justify-between rounded-xl border border-warn bg-surface px-4 py-3 hover:border-ink"
                    >
                      <span className="font-semibold">{store.name}</span>
                      <span className="text-[13px] tabular-nums">
                        {store.cancelled} из {store.orders} · {percent(store.cancelRate)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Link
          href="/sellers"
          className="grid gap-1 rounded-xl border border-line bg-surface p-4 hover:border-ink"
        >
          <span className="text-[12px] text-muted">Магазины ждут проверки</span>
          <span
            className={`text-2xl font-bold tabular-nums ${stores?.counts.PENDING_VERIFICATION ? 'text-warn' : ''}`}
          >
            {stores?.counts.PENDING_VERIFICATION ?? '—'}
          </span>
        </Link>
        <div className="grid gap-1 rounded-xl border border-line bg-surface p-4">
          <span className="text-[12px] text-muted">Ваши роли</span>
          <span className="flex flex-wrap gap-1.5">
            {me?.roles.map((role) => (
              <Pill key={role} tone="info">
                {role}
              </Pill>
            ))}
          </span>
        </div>
      </div>
      <Notice tone="info">
        Сессия сотрудника действует не дольше 8 часов. После этого нужно снова ввести пароль и код
        из приложения.
      </Notice>
    </div>
  );
}
