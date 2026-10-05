import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  const otherLocaleHref = locale === 'kk' ? '/' : '/kk';

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-8 px-4 py-16">
      <header className="flex items-center justify-between">
        <span className="font-display text-2xl font-black tracking-tight">
          last<span className="text-sale">size</span>
        </span>
        <Link href={otherLocaleHref} className="text-sm text-muted underline underline-offset-4">
          {t('language')}
        </Link>
      </header>

      <section className="flex flex-col gap-5">
        <span className="w-fit rounded-full bg-ok-soft px-3 py-1 text-xs font-semibold text-ok">
          {t('badge')}
        </span>
        <h1 className="font-display text-4xl leading-none font-black tracking-tight text-balance sm:text-6xl">
          {t('headline')} <span className="text-sale">{t('discount')}</span>
        </h1>
        <p className="max-w-prose text-lg text-pretty">{t('lead')}</p>
        <p className="max-w-prose text-muted">{t('sellers')}</p>
      </section>

      <footer className="text-xs text-muted">{t('status')}</footer>
    </main>
  );
}
