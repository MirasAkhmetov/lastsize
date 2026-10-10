import { groupBySize, parseTengeAmount } from '@lastsize/domain';
import { XMLParser } from 'fast-xml-parser';
import { clip, type ImportCandidate, MAX_IMPORT_ROWS, SourceRejectedError } from './candidate';

/** Kaspi city id of Almaty, our launch city. */
const ALMATY_CITY_ID = '750000000';

interface KaspiOffer {
  '@_sku'?: string | number;
  model?: string | number;
  brand?: string | number;
  price?: string | number;
  cityprices?: {
    cityprice?: ({ '#text'?: string | number; '@_cityId'?: string | number } | number)[];
  };
  availabilities?: {
    availability?: { '@_available'?: string; '@_stockCount'?: string | number }[];
  };
}

function offerPrice(offer: KaspiOffer): number | null {
  if (offer.price !== undefined) return parseTengeAmount(offer.price);
  const cities = offer.cityprices?.cityprice ?? [];
  const entries = cities.map((entry) =>
    typeof entry === 'object'
      ? { city: String(entry['@_cityId'] ?? ''), price: entry['#text'] }
      : { city: '', price: entry },
  );
  const almaty = entries.find((entry) => entry.city === ALMATY_CITY_ID) ?? entries[0];
  return almaty ? parseTengeAmount(almaty.price) : null;
}

function offerStock(offer: KaspiOffer): number {
  return (offer.availabilities?.availability ?? [])
    .filter((entry) => entry['@_available'] === 'yes')
    .reduce(
      (sum, entry) => sum + Math.max(0, Math.floor(Number(entry['@_stockCount'] ?? 0)) || 0),
      0,
    );
}

/**
 * Kaspi price list (kaspi_catalog XML). It has no photos or categories and lists one offer per
 * size, so offers are grouped by model name and the seller adds photos in the wizard.
 */
export function parseKaspiXml(xml: Buffer): ImportCandidate[] {
  const text = xml.toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new SourceRejectedError('kaspi.invalidXml');
  let document: { kaspi_catalog?: { offers?: { offer?: KaspiOffer[] } } };
  try {
    document = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true,
      htmlEntities: false,
      isArray: (name) => ['offer', 'availability', 'cityprice'].includes(name),
    }).parse(text, true);
  } catch {
    throw new SourceRejectedError('kaspi.invalidXml');
  }
  const offers = document.kaspi_catalog?.offers?.offer;
  if (!offers) throw new SourceRejectedError('kaspi.invalidXml');
  if (offers.length === 0) throw new SourceRejectedError('source.empty');

  const items = offers
    .map((offer) => ({
      sku: clip(offer['@_sku'], 100),
      name: clip(offer.model, 200) ?? '',
      brand: clip(offer.brand, 60),
      price: offerPrice(offer),
      stock: offerStock(offer),
    }))
    .filter((item) => item.sku && item.name);

  const candidates = groupBySize(items).map((group): ImportCandidate => {
    const prices = group.items.map((entry) => entry.item.price).filter((p): p is number => !!p);
    const price = prices.length ? Math.min(...prices) : null;
    return {
      externalId: group.items[0]!.item.sku!,
      data: {
        title: group.name.slice(0, 120),
        brand: group.items[0]!.item.brand,
        description: null,
        composition: null,
        article: null,
        sourceCategory: null,
        sourceColor: null,
        sourceGender: null,
        photos: [],
        sizes: group.items.map((entry) => ({
          label: entry.size,
          quantity: entry.item.stock,
          externalSizeId: entry.item.sku,
          barcode: null,
        })),
      },
      originalPrice: price,
      salePrice: null,
      externalPrice: price,
    };
  });
  if (candidates.length > MAX_IMPORT_ROWS) throw new SourceRejectedError('source.tooManyRows');
  return candidates;
}
