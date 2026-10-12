import { Pill } from '@lastsize/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDateTime } from '@/components/order-labels';
import { getIntegrationHealth } from '@/server/api';

export const metadata: Metadata = { title: 'Синхронизации' };

export default async function IntegrationsPage() {
  const rows = await getIntegrationHealth();
  return (
    <div className="grid max-w-5xl gap-5">
      <h1 className="text-2xl font-bold">Синхронизации с маркетплейсами</h1>
      <p className="text-[13.5px] text-muted">
        Сначала подключения с ошибкой и давно не проверенные. Конфликты — продажи на маркетплейсе
        товара, который уже был забронирован у нас.
      </p>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted">Подключений пока нет.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-[13px]">
            <thead className="text-left text-[11.5px] text-muted uppercase">
              <tr>
                {[
                  'Магазин',
                  'Источник',
                  'Статус',
                  'Последняя проверка',
                  'Ошибка',
                  'Размеров',
                  'Сбоев 7 дн.',
                  'Конфликтов 7 дн.',
                ].map((head) => (
                  <th key={head} className="px-3 py-2 font-semibold">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.storeId}-${row.provider}`} className="border-t border-line">
                  <td className="px-3 py-2">
                    <Link href={`/sellers/${row.storeId}`} className="underline">
                      {row.storeName}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{row.provider === 'WILDBERRIES' ? 'WB' : 'Kaspi'}</td>
                  <td className="px-3 py-2">
                    {!row.syncEnabled ? (
                      <Pill>выключена</Pill>
                    ) : row.status === 'ERROR' ? (
                      <Pill tone="sale">ошибка</Pill>
                    ) : (
                      <Pill tone="ok">работает</Pill>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.lastSyncAt ? formatDateTime(row.lastSyncAt) : '—'}
                  </td>
                  <td className="px-3 py-2">{row.lastError ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{row.linkedCount}</td>
                  <td className="px-3 py-2 tabular-nums">{row.failedRuns7d}</td>
                  <td className="px-3 py-2 tabular-nums">{row.conflicts7d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
