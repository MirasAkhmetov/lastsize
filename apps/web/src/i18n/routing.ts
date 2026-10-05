import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['ru', 'kk'],
  defaultLocale: 'ru',
  // Russian lives at /catalog, Kazakh at /kk/catalog.
  localePrefix: 'as-needed',
});

export type Locale = (typeof routing.locales)[number];
