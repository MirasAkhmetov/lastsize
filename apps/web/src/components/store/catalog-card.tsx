import { type CatalogCard as Card, productPath } from '@lastsize/contracts';
import { ProductCard, ProductImage } from '@lastsize/ui';
import { getLocale, getTranslations } from 'next-intl/server';
import { getPathname } from '@/i18n/navigation';

/** A catalog card with an honest scarcity note computed from real stock. */
export async function CatalogCard({ card, priority = false }: { card: Card; priority?: boolean }) {
  const t = await getTranslations('catalog');
  const locale = await getLocale();
  const lang = locale === 'kk' ? 'kk' : 'ru';
  const inStock = card.sizes.filter((size) => size.available > 0);
  const scarcityNote =
    inStock.length === 1 && inStock[0]!.label && card.sizes.length > 1
      ? t('lastSize', { size: inStock[0]!.label })
      : card.available <= 2
        ? t('lastPieces', { count: card.available })
        : undefined;

  return (
    <ProductCard
      href={getPathname({ href: productPath(card), locale })}
      brand={card.brand ?? ''}
      title={card.title}
      salePrice={card.salePrice}
      originalPrice={card.originalPrice}
      discountPercent={card.discountPercent}
      sizes={card.sizes
        .filter((size) => size.label)
        .map((size) => ({ label: size.label!, available: size.available > 0 }))}
      scarcityNote={scarcityNote}
      storeName={card.store.name}
      city={card.store.city[lang]}
      image={
        card.image ? (
          <ProductImage
            url={card.image.url}
            alt={`${card.brand ?? ''} ${card.title}`}
            priority={priority}
          />
        ) : undefined
      }
    />
  );
}
