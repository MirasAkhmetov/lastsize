import { ToastProvider } from '@lastsize/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
// Fonts are bundled with the app (no requests to Google at build or run time).
import '@fontsource-variable/golos-text';
import '@fontsource-variable/unbounded';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'LastSize admin', template: '%s · LastSize admin' },
  robots: { index: false, follow: false },
};

// Every page depends on the session and gets a fresh CSP nonce.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
