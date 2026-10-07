import { buttonClasses, EmptyState, Pill } from '@lastsize/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getUsers } from '@/server/api';

export const metadata: Metadata = { title: 'Пользователи' };

const PAGE_SIZE = 25;
const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Almaty',
});

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const page = Math.max(
    1,
    Math.min(4000, Number.parseInt((await searchParams).page ?? '1', 10) || 1),
  );
  const data = await getUsers(PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="grid gap-5">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-bold">Пользователи</h1>
        <span className="text-[13px] text-muted tabular-nums">Всего: {total}</span>
      </div>
      {!data || data.items.length === 0 ? (
        <EmptyState
          title="Пользователей пока нет"
          description="Продавцы появятся здесь после регистрации."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="text-[11px] tracking-wide text-muted uppercase">
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 font-semibold">Имя</th>
                <th className="px-4 py-2.5 font-semibold">Телефон</th>
                <th className="px-4 py-2.5 font-semibold">Роли</th>
                <th className="px-4 py-2.5 font-semibold">Статус</th>
                <th className="px-4 py-2.5 font-semibold">Регистрация</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((user) => (
                <tr key={user.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium">{user.name}</td>
                  <td className="px-4 py-3 tabular-nums">{user.phone}</td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap gap-1">
                      {user.roles.length ? (
                        user.roles.map((role) => (
                          <Pill key={role} tone="info">
                            {role}
                          </Pill>
                        ))
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Pill tone={user.status === 'ACTIVE' ? 'ok' : 'sale'}>
                      {user.status === 'ACTIVE' ? 'Активен' : 'Заблокирован'}
                    </Pill>
                  </td>
                  <td className="px-4 py-3 text-muted tabular-nums">
                    {dateFormat.format(new Date(user.createdAt))}
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
            <Link href={`/users?page=${page - 1}`} className={buttonClasses('ghost', 'sm')}>
              ← Назад
            </Link>
          )}
          <span className="text-muted tabular-nums">
            {page} из {pages}
          </span>
          {page < pages && (
            <Link href={`/users?page=${page + 1}`} className={buttonClasses('ghost', 'sm')}>
              Дальше →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
