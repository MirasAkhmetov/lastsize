import { buttonClasses, Logo } from '@lastsize/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LanguageLink } from '@/components/language-link';
import { Link } from '@/i18n/navigation';

export default async function SellerLandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('seller');
  const nav = await getTranslations('nav');
  return (
    <div className="mx-auto grid min-h-dvh max-w-5xl content-start gap-12 px-4 py-5 md:px-6">
      <header className="flex items-center justify-between">
        <Link href="/" className="text-xl">
          <Logo suffix={t('portal')} />
        </Link>
        <div className="flex items-center gap-4 text-[13px]">
          <LanguageLink className="text-muted">{nav('languageShort')}</LanguageLink>
          <Link href="/seller/login" className={buttonClasses('ghost', 'sm')}>
            {t('login')}
          </Link>
        </div>
      </header>
      <section className="grid gap-6 md:grid-cols-[1.3fr_1fr] md:items-end">
        <div className="grid gap-4">
          <h1 className="font-display text-4xl leading-none font-black tracking-tight text-balance md:text-6xl">
            {t('landingTitle')}
          </h1>
          <p className="max-w-prose text-lg text-pretty text-muted">{t('landingLead')}</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/seller/join" className={buttonClasses('primary')}>
              {t('join')}
            </Link>
            <Link href="/seller/login" className={buttonClasses('ghost')}>
              {t('login')}
            </Link>
          </div>
        </div>
        <ul className="grid gap-2">
          {(['landingPoint1', 'landingPoint2', 'landingPoint3'] as const).map((key) => (
            <li
              key={key}
              className="flex gap-3 rounded-xl border border-line bg-surface p-4 text-[14px]"
            >
              <span aria-hidden className="font-bold text-ok">
                ✓
              </span>
              {t(key)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
