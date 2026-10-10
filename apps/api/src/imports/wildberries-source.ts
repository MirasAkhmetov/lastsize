import { clip, type ImportCandidate, MAX_PHOTOS } from './candidate';
import type { WbCard, WbPrice } from './wildberries.client';

function characteristic(card: WbCard, ...names: string[]): string | null {
  const found = card.characteristics?.find((c) => names.includes(c.name.toLowerCase()));
  if (!found) return null;
  const value = Array.isArray(found.value) ? found.value.join(', ') : found.value;
  return clip(value, 200);
}

/** WB uses techSize "0" (and an empty wbSize) for one-size goods. */
function sizeLabel(size: WbCard['sizes'][number]): string | null {
  const label = (size.techSize || size.wbSize || '').trim();
  return label === '' || label === '0' ? null : label;
}

/**
 * WB cards with prices and FBS stock. Prices are used only when WB reports them in tenge;
 * otherwise the seller enters prices in the wizard (see the job warnings).
 */
export function wildberriesCandidates(
  cards: WbCard[],
  prices: Map<number, WbPrice>,
  stocks: Map<number, number>,
): ImportCandidate[] {
  return cards.map((card) => {
    const price = prices.get(card.nmID);
    const inTenge = price?.currency === 'KZT';
    return {
      externalId: String(card.nmID),
      data: {
        title: clip(card.title, 120) ?? card.vendorCode ?? String(card.nmID),
        brand: clip(card.brand, 60),
        description: clip(card.description, 4000),
        composition: characteristic(card, 'состав'),
        article: clip(card.vendorCode, 60),
        sourceCategory: clip(card.subjectName, 100),
        sourceColor: characteristic(card, 'цвет', 'основной цвет'),
        sourceGender: characteristic(card, 'пол'),
        photos: (card.photos ?? [])
          .map((photo) => photo.big)
          .filter((url): url is string => typeof url === 'string' && /^https?:\/\//.test(url))
          .slice(0, MAX_PHOTOS),
        sizes: (card.sizes ?? []).map((size) => ({
          label: sizeLabel(size),
          quantity: Math.min(stocks.get(size.chrtID) ?? 0, 9_999),
          externalSizeId: String(size.chrtID),
          barcode: size.skus?.[0] ?? null,
        })),
      },
      originalPrice: inTenge ? Math.round(price.price) * 100 : null,
      salePrice: null,
      externalPrice: inTenge ? Math.round(price.discountedPrice) * 100 : null,
    };
  });
}
