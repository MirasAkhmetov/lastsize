import { STORE_STATUSES, type StoreStatus } from '@lastsize/contracts';
import { buttonClasses, cn, EmptyState, Pill } from '@lastsize/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { dateTime, STORE_STATUS_LABEL, STORE_STATUS_TONE } from '@/components/store-labels';
import { getStores } from '@/server/api';

export const metadata: Metadata = { title: 'Продавцы' };

const PAGE_SIZE = 25;

export default async function SellersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const query = await searchParams;
  const status: StoreStatus = (STORE_STATUSES as readonly string[]).includes(query.status ?? '')
    ? (query.status as StoreStatus)
    : 'PENDING_VERIFICATION';
  const page = Math.max(1, Math.min(4000, Number.parseInt(query.page ?? '1', 10) || 1));
  const data = await getStores(status, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  return (
    <div className="grid gap-5">
      <h1 className="text-2xl font-bold">Продавцы</h1>
      <nav aria-label="Статус" className="flex gap-5 overflow-x-auto border-b border-line text-sm">
        {STORE_STATUSES.map((value) => (
          <Link
            key={value}
            href={`/sellers?status=${value}`}
            aria-current={value === status ? 'page' : undefined}
            className={cn(
              'border-b-2 py-2 whitespace-nowrap',
              value === status
                ? 'border-ink font-semibold'
                : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {STORE_STATUS_LABEL[value]} ·{' '}
            <span className="tabular-nums">{data?.counts[value] ?? 0}</span>
          </Link>
        ))}
      </nav>
      {status === 'PENDING_VERIFICATION' && (
        <p className="text-[13px] text-muted">
          Сначала самые старые заявки. Перед подтверждением позвоните владельцу и сверьте БИН/ИИН.
        </p>
      )}

      {!data || data.items.length === 0 ? (
        <EmptyState title="Здесь пусто" description="Магазинов с этим статусом нет." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="text-[11px] tracking-wide text-muted uppercase">
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 font-semibold">Магазин</th>
                <th className="px-4 py-2.5 font-semibold">Владелец</th>
                <th className="px-4 py-2.5 font-semibold">Телефон</th>
                <th className="px-4 py-2.5 font-semibold">Город</th>
                <th className="px-4 py-2.5 font-semibold">Заявка</th>
                <th className="px-4 py-2.5 font-semibold">Статус</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((store) => (
                <tr key={store.id} className="border-b border-line last:border-0 hover:bg-soft">
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/sellers/${store.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {store.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{store.ownerName}</td>
                  <td className="px-4 py-3 tabular-nums">{store.ownerPhone}</td>
                  <td className="px-4 py-3">{store.city}</td>
                  <td className="px-4 py-3 text-muted tabular-nums">
                    {dateTime.format(new Date(store.createdAt))}
                  </td>
                  <td className="px-4 py-3">
                    <Pill tone={STORE_STATUS_TONE[store.status]}>
                      {STORE_STATUS_LABEL[store.status]}
                    </Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav aria-label="Страницы" className="flex items-center gap-3 text-[13px]">
          {page > 1 && (
            <Link
              href={`/sellers?status=${status}&page=${page - 1}`}
              className={buttonClasses('ghost', 'sm')}
            >
              ← Назад
            </Link>
          )}
          <span className="text-muted tabular-nums">
            {page} из {pages}
          </span>
          {page < pages && (
            <Link
              href={`/sellers?status=${status}&page=${page + 1}`}
              className={buttonClasses('ghost', 'sm')}
            >
              Дальше →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
