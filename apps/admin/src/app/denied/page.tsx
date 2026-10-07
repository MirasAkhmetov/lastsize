import type { Metadata } from 'next';
import { Centered } from '@/components/centered';
import { LogoutButton } from '@/components/logout-button';

export const metadata: Metadata = { title: 'Нет доступа' };

export default function DeniedPage() {
  return (
    <Centered title="Нет доступа к админке">
      <p className="text-[14px] text-muted">
        Этот аккаунт не является сотрудником платформы. Войдите под учётной записью сотрудника.
      </p>
      <LogoutButton />
    </Centered>
  );
}
