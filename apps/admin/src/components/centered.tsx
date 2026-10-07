import { Logo } from '@lastsize/ui';
import type { ReactNode } from 'react';

export function Centered({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-start justify-center px-4 pt-16 md:place-items-center md:pt-0">
      <div className="grid w-full max-w-sm gap-5">
        <Logo className="text-xl" suffix="admin" />
        <h1 className="text-2xl font-bold">{title}</h1>
        {children}
      </div>
    </main>
  );
}
