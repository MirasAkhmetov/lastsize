import { Logo } from '@lastsize/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AdminNav } from '@/components/admin-nav';
import { LogoutButton } from '@/components/logout-button';
import { getMe, staffGate } from '@/server/api';

/** The panel requires a staff account that passed the TOTP check. The API enforces the same rules. */
export default async function PanelLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  const gate = staffGate(me);
  if (gate) redirect(gate);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[220px_1fr]">
      <aside className="border-b border-line bg-surface md:min-h-dvh md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-4 py-3 md:px-5 md:py-5">
          <Link href="/" className="text-lg">
            <Logo suffix="admin" />
          </Link>
          <div className="md:hidden">
            <LogoutButton />
          </div>
        </div>
        <div className="px-2 pb-2 md:px-3">
          <AdminNav />
        </div>
        <div className="hidden gap-1 px-5 py-4 text-[13px] text-muted md:grid">
          <span className="truncate text-ink">{me!.user.name}</span>
          <span>{me!.roles.join(', ')}</span>
          <LogoutButton />
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
