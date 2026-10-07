import { ToastProvider } from '@lastsize/ui';
import type { Metadata } from 'next';
import { Golos_Text, Unbounded } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const unbounded = Unbounded({
  subsets: ['latin', 'cyrillic', 'cyrillic-ext'],
  weight: ['700', '900'],
  variable: '--font-unbounded',
  display: 'swap',
});
const golos = Golos_Text({
  subsets: ['latin', 'cyrillic', 'cyrillic-ext'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-golos',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'LastSize admin', template: '%s · LastSize admin' },
  robots: { index: false, follow: false },
};

// Every page depends on the session and gets a fresh CSP nonce.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={`${unbounded.variable} ${golos.variable}`}>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
