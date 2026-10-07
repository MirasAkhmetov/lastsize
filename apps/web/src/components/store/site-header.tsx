import { Logo } from '@lastsize/ui';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { BagIcon, HeartIcon, SearchIcon } from '../icons';
import { LanguageLink } from '../language-link';

const CATEGORY_LINKS = [
  { key: 'women', href: '/catalog/women' },
  { key: 'men', href: '/catalog/men' },
  { key: 'kids', href: '/catalog/kids' },
  { key: 'shoes', href: '/catalog/shoes' },
  { key: 'clothing', href: '/catalog/clothing' },
  { key: 'accessories', href: '/catalog/accessories' },
] as const;

export async function SiteHeader() {
  const t = await getTranslations('nav');
  const locale = await getLocale();
  return (
    <header className="sticky top-[env(safe-area-inset-top)] z-30 border-b border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 md:gap-6 md:px-6">
        <Link href="/" className="shrink-0 text-lg md:text-xl" aria-label="LastSize">
          <Logo />
        </Link>
        <form
          action={`${locale === 'kk' ? '/kk' : ''}/catalog`}
          role="search"
          className="min-w-0 flex-1 md:max-w-md"
        >
          <label className="flex items-center gap-2 rounded-ctl bg-soft px-3 py-2 text-muted">
            <SearchIcon width={18} height={18} />
            <span className="sr-only">{t('search')}</span>
            <input
              name="q"
              type="search"
              placeholder={t('searchPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-muted"
            />
          </label>
        </form>
        <nav
          className="ml-auto hidden items-center gap-5 text-[13px] md:flex"
          aria-label={t('mainNavigation')}
        >
          <Link href="/seller" className="text-muted hover:text-ink">
            {t('forSellers')}
          </Link>
          <Link href="/favorites" className="flex items-center gap-1.5 hover:text-sale">
            <HeartIcon width={20} height={20} /> {t('favorites')}
          </Link>
          <Link href="/cart" className="flex items-center gap-1.5 hover:text-sale">
            <BagIcon width={20} height={20} /> {t('cart')}
          </Link>
          <LanguageLink className="text-muted hover:text-ink">{t('languageShort')}</LanguageLink>
        </nav>
        <LanguageLink className="text-[12px] font-semibold text-muted md:hidden">
          {t('languageShort')}
        </LanguageLink>
      </div>
      <nav
        className="mx-auto flex max-w-7xl gap-5 overflow-x-auto px-4 pb-2.5 text-[13.5px] whitespace-nowrap md:px-6"
        aria-label={t('categoriesNavigation')}
      >
        <Link href="/catalog" className="font-display font-bold text-sale">
          {t('sale')}
        </Link>
        {CATEGORY_LINKS.map((item) => (
          <Link key={item.key} href={item.href} className="hover:text-sale">
            {t(item.key)}
          </Link>
        ))}
      </nav>
    </header>
  );
}
