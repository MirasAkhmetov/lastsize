import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Centered } from '@/components/centered';
import { LoginForm } from '@/components/login-form';
import { getMe, staffGate } from '@/server/api';

export const metadata: Metadata = { title: 'Вход' };

export default async function LoginPage() {
  const me = await getMe();
  if (me) redirect(staffGate(me) ?? '/');
  return (
    <Centered title="Вход для сотрудников">
      <LoginForm />
    </Centered>
  );
}
