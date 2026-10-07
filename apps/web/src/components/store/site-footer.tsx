import { Logo } from '@lastsize/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export async function SiteFooter() {
  const t = await getTranslations('footer');
  return (
    <footer className="mt-16 border-t border-line pb-24 md:pb-0">
      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-8 text-[13px] text-muted md:grid-cols-[1fr_auto] md:px-6">
        <div className="grid gap-2">
          <Logo className="text-base text-ink" />
          <p className="max-w-prose">{t('about')}</p>
          <p>{t('returns')}</p>
        </div>
        <nav className="flex gap-5">
          <Link href="/seller" className="hover:text-ink">
            {t('sellers')}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
