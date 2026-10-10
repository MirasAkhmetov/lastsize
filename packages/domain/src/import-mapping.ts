/**
 * Best guesses for imported goods: marketplace category names and titles → our category,
 * gender, colour and size. Every guess can be corrected by the seller in the import wizard;
 * a wrong guess only costs a click, a missing one leaves the row "needs attention".
 */

type Gender = 'WOMEN' | 'MEN' | 'UNISEX' | 'KIDS';

function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/** Ordered most specific first: "джинсовая куртка" is a jacket, "кроссовки" are not "кросс...". */
const CATEGORY_RULES: [slug: string, pattern: RegExp][] = [
  ['high-boots', /сапог|ботфорт|угги|дутик|валенк|етік/],
  ['sneakers', /кроссовк|кеды|сникер|слипон/],
  ['loafers', /лофер|мокасин|топсайдер/],
  ['sandals', /сандал|босонож|шлепан|сланц|мюли|сабо/],
  ['classic-shoes', /туфл|балетк|лодочк|оксфорд|дерби|броги/],
  ['boots', /ботинк|ботильон|челси|полуботин|бәтеңке/],
  ['coats', /пальто|тренч|плащ/],
  ['jackets', /куртк|пуховик|ветровк|бомбер|парка|жилет|косух|анорак|күрте/],
  ['sportswear', /спортивн|леггинс|лосин|тайтс|велосипедк|олимпийк/],
  ['suits', /костюм|пиджак|жакет|блейзер/],
  ['hoodies', /худи|толстовк|свитшот|лонгслив/],
  ['sweaters', /свитер|джемпер|кардиган|пуловер|водолазк/],
  ['dresses', /плать|сарафан|көйлек/],
  ['skirts', /юбк/],
  ['jeans', /джинс(?!ов)|джинсы/],
  ['trousers', /брюк|штан|шорт|джоггер|чинос|шалбар|бридж|кюлот/],
  ['shirts', /рубашк|блуз|сорочк|жейде/],
  ['t-shirts', /футболк|майк|(?:^|[^а-я])(?:топ|поло)(?![а-я])/],
  ['backpacks', /рюкзак/],
  ['wallets', /кошел|портмоне|визитниц|кардхолдер|әмиян/],
  ['bags', /сумк|клатч|шопер|саквояж|портфел|сөмке/],
  ['belts', /ремень|ремни|пояс|белдік/],
  ['hats', /шапк|кепк|бейсболк|панам|берет|шляп|бандан|балаклав/],
  ['scarves', /шарф|палантин|платок|снуд|бактус/],
  ['sunglasses', /очки|көзілдірік/],
];

/** Our category slug for a source category name or product title, or null when unsure. */
export function guessCategorySlug(...texts: (string | null | undefined)[]): string | null {
  for (const text of texts) {
    if (!text) continue;
    const value = normalize(text);
    for (const [slug, pattern] of CATEGORY_RULES) if (pattern.test(value)) return slug;
  }
  return null;
}

export function guessGender(...texts: (string | null | undefined)[]): Gender | null {
  const value = normalize(texts.filter(Boolean).join(' '));
  if (!value) return null;
  if (/детск|для мальчик|для девоч|подростк|малыш|балалар|\bkids?\b|junior/.test(value))
    return 'KIDS';
  if (/унисекс|unisex/.test(value)) return 'UNISEX';
  const women = /женск|для женщин|\bwomen|\bwmns?\b|әйелдер/.test(value);
  const men = /мужск|для мужчин|\bmen\b|ерлер/.test(value);
  if (women && men) return 'UNISEX';
  if (women) return 'WOMEN';
  if (men) return 'MEN';
  return null;
}

/** Ordered so that "темно-синий" wins over "синий" and "светло-серый" stays grey. */
const COLOR_RULES: [code: string, pattern: RegExp][] = [
  ['multicolor', /разноцвет|мульти|принт|multicolor/],
  ['navy', /темно-син|темно син|navy|индиго/],
  ['light-blue', /голуб|светло-син|бирюз|мятн/],
  ['blue', /син|blue|васильк/],
  ['black', /черн|графит|black/],
  ['white', /бел(?!ь)|молочн|айвори|white/],
  ['grey', /сер(?!еб)|grey|gray|антрацит|меланж/],
  ['beige', /беж|песочн|кремов|бежев|nude|нюд|капучино|кэмел|camel/],
  ['brown', /коричн|шоколад|кофейн|хаки-кор|brown|табачн|рыж/],
  ['red', /красн|бордо|вишн|алый|марсал|red/],
  ['pink', /розов|фукси|пудров|pink/],
  ['orange', /оранж|терракот|коралл|orange/],
  ['yellow', /желт|горчичн|лимон|yellow/],
  ['green', /зелен|хаки|олив|изумруд|green/],
  ['purple', /фиолет|сирен|лилов|лаванд|purple/],
  ['silver', /серебр|silver/],
  ['gold', /золот|gold/],
];

/** The colour named first wins: "черный с белым" is black. */
export function guessColorCode(...texts: (string | null | undefined)[]): string | null {
  for (const text of texts) {
    if (!text) continue;
    const value = normalize(text);
    let best: { code: string; index: number } | null = null;
    for (const [code, pattern] of COLOR_RULES) {
      const index = value.search(pattern);
      if (index >= 0 && (!best || index < best.index)) best = { code, index };
    }
    if (best) return best.code;
  }
  return null;
}

/** Russian clothing sizes (and ranges like "44-46") → international letters. */
const RU_CLOTHING: Record<string, string> = {
  '40': 'XS',
  '42': 'XS',
  '44': 'S',
  '46': 'M',
  '48': 'L',
  '50': 'XL',
  '52': 'XXL',
  '54': 'XXXL',
  '56': 'XXXL',
};
const LETTER_ALIASES: Record<string, string> = {
  '2XL': 'XXL',
  '3XL': 'XXXL',
  XXS: 'XS',
};

/**
 * Our size code (as in the size chart) for a marketplace size label, or null when it doesn't
 * map unambiguously. `codes` are the chart's codes, e.g. ['XS', 'S', ...] or ['20', ..., '46'].
 */
export function matchSizeCode(
  label: string | null | undefined,
  chart: 'CLOTHING_INT' | 'SHOES_EU' | 'KIDS_HEIGHT',
  codes: readonly string[],
): string | null {
  if (!label) return null;
  let value = label.toUpperCase().replace(/\s+/g, '').replace(',', '.');
  value = value.replace(/^(EU|RU|РАЗМЕР|Р\.?)/, '');
  const known = (code: string | undefined) => (code && codes.includes(code) ? code : null);
  if (chart === 'CLOTHING_INT') {
    const letters = value.split('/')[0]!;
    if (known(LETTER_ALIASES[letters] ?? letters)) return LETTER_ALIASES[letters] ?? letters;
    // "46", "44-46" (the lower bound decides, as on WB)
    const ru = /^(\d{2})(?:-\d{2})?$/.exec(value);
    return ru ? known(RU_CLOTHING[ru[1]!]) : null;
  }
  if (chart === 'SHOES_EU') return /^\d{2}$/.test(value) ? known(value) : null;
  // Kids: height in cm, "110" or "110-116" (the lower bound is the size).
  const height = /^(\d{2,3})(?:-\d{2,3})?(?:СМ)?$/.exec(value);
  return height ? known(height[1]) : null;
}

/** Size at the end of a Kaspi-style model name: "Кроссовки Nike Air белые 42" → "42". */
const TRAILING_SIZE =
  /^(.*?)[\s,(/]+(?:р(?:азмер)?\.?\s*)?(XXXL|XXL|XL|XS|S|M|L|2XL|3XL|\d{2}(?:[.,]5)?|\d{2,3}-\d{2,3})\)?$/iu;

export function splitTrailingSize(model: string): { base: string; size: string | null } {
  const match = TRAILING_SIZE.exec(model.trim());
  if (!match || match[1]!.trim().length < 3) return { base: model.trim(), size: null };
  return { base: match[1]!.trim(), size: match[2]!.toUpperCase() };
}

/**
 * Groups one-offer-per-size listings (Kaspi XML) into products. A trailing number is treated as
 * a size only when several offers share the rest of the name ("Air Max 90" stays a model name).
 */
export function groupBySize<T extends { name: string }>(
  items: T[],
): { name: string; items: { item: T; size: string | null }[] }[] {
  const split = items.map((item) => ({ item, ...splitTrailingSize(item.name) }));
  const counts = new Map<string, number>();
  for (const entry of split)
    if (entry.size) counts.set(entry.base, (counts.get(entry.base) ?? 0) + 1);
  const groups = new Map<string, { name: string; items: { item: T; size: string | null }[] }>();
  for (const entry of split) {
    const grouped = entry.size !== null && (counts.get(entry.base) ?? 0) > 1;
    const name = grouped ? entry.base : entry.item.name.trim();
    const key = normalize(name);
    const group = groups.get(key) ?? { name, items: [] };
    group.items.push({ item: entry.item, size: grouped ? entry.size : null });
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * Sale price (tiyn) for a `percent` discount from `basePrice` (tiyn). Rounded down to a price
 * ending in 90 tenge (14 990 ₸), so the actual discount is never smaller than asked.
 */
export function salePriceFromPercent(basePrice: number, percent: number): number {
  const tenge = Math.floor((basePrice * (100 - percent)) / 100 / 100);
  if (tenge < 1000) return Math.max(tenge, 1) * 100;
  return (Math.floor((tenge - 90) / 100) * 100 + 90) * 100;
}

/** "12 990,00", "12990.5", "12 990 ₸" → tiyn, whole tenge (kopecks are dropped). */
export function parseTengeAmount(value: unknown): number | null {
  if (typeof value === 'number')
    return Number.isFinite(value) && value > 0 ? Math.floor(value) * 100 : null;
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\s₸тгTGKZT]/gi, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const tenge = Math.floor(Number(clean));
  return tenge > 0 && tenge <= 100_000_000 ? tenge * 100 : null;
}
