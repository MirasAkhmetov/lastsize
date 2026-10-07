import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Centered } from '@/components/centered';
import { LogoutButton } from '@/components/logout-button';
import { MfaForm } from '@/components/mfa-form';
import { getMe, staffGate } from '@/server/api';

export const metadata: Metadata = { title: 'Подтверждение входа' };

export default async function MfaPage() {
  const me = await getMe();
  const gate = staffGate(me);
  if (gate !== '/mfa') redirect(gate ?? '/');
  return (
    <Centered title={me!.mfa.enrolled ? 'Код из приложения' : 'Двухфакторная защита'}>
      <MfaForm enrolled={me!.mfa.enrolled} />
      <LogoutButton />
    </Centered>
  );
}
