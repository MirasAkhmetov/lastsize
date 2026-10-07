import { Notice, Pill } from '@lastsize/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getMe, getStores, getUsers } from '@/server/api';

export const metadata: Metadata = { title: 'Обзор' };

export default async function OverviewPage() {
  const [me, users, stores] = await Promise.all([
    getMe(),
    getUsers(1, 0),
    getStores('PENDING_VERIFICATION', 1, 0),
  ]);
  return (
    <div className="grid max-w-4xl gap-6">
      <h1 className="text-2xl font-bold">Обзор</h1>
      <div className="grid gap-3 md:grid-cols-3">
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
        <Link
          href="/users"
          className="grid gap-1 rounded-xl border border-line bg-surface p-4 hover:border-ink"
        >
          <span className="text-[12px] text-muted">Пользователей (продавцы и сотрудники)</span>
          <span className="text-2xl font-bold tabular-nums">{users?.total ?? '—'}</span>
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
