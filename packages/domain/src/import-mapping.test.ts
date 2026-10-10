import { describe, expect, it } from 'vitest';
import {
  groupBySize,
  guessCategorySlug,
  guessColorCode,
  guessGender,
  matchSizeCode,
  parseTengeAmount,
  salePriceFromPercent,
  splitTrailingSize,
} from './import-mapping.js';

const CLOTHING = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const SHOES = Array.from({ length: 27 }, (_, i) => String(20 + i));
const KIDS = ['74', '80', '86', '92', '98', '104', '110', '116', '122', '128'];

describe('guessCategorySlug', () => {
  it.each([
    ['Кроссовки', 'sneakers'],
    ['Кеды', 'sneakers'],
    ['Сапоги', 'high-boots'],
    ['Ботинки', 'boots'],
    ['Полуботинки', 'boots'],
    ['Куртки', 'jackets'],
    ['Джинсовая куртка', 'jackets'],
    ['Джинсы', 'jeans'],
    ['Шорты джинсовые', 'trousers'],
    ['Платья', 'dresses'],
    ['Худи', 'hoodies'],
    ['Спортивный костюм', 'sportswear'],
    ['Костюм классический', 'suits'],
    ['Топ', 't-shirts'],
    ['Футболка поло', 't-shirts'],
    ['Рюкзак городской', 'backpacks'],
    ['Сумка через плечо', 'bags'],
    ['Солнцезащитные очки', 'sunglasses'],
  ])('%s → %s', (text, slug) => {
    expect(guessCategorySlug(text)).toBe(slug);
  });

  it('falls back to the title and gives up on unknown goods', () => {
    expect(guessCategorySlug(null, 'Nike Air Force 1 кроссовки мужские')).toBe('sneakers');
    expect(guessCategorySlug('Товары для дома', 'Подушка')).toBeNull();
    expect(guessCategorySlug('Топор')).toBeNull();
  });
});

describe('guessGender', () => {
  it.each([
    ['Кроссовки женские', 'WOMEN'],
    ['Куртка мужская', 'MEN'],
    ['Платье для девочки', 'KIDS'],
    ['Худи унисекс', 'UNISEX'],
    ['Nike Wmns Air Max', 'WOMEN'],
    ['Кроссовки', null],
  ])('%s → %s', (text, gender) => {
    expect(guessGender(text)).toBe(gender);
  });
});

describe('guessColorCode', () => {
  it.each([
    ['черный', 'black'],
    ['Тёмно-синий', 'navy'],
    ['светло-серый', 'grey'],
    ['серебристый', 'silver'],
    ['белый', 'white'],
    ['черный с белым', 'black'],
    ['молочный', 'white'],
    ['хаки', 'green'],
    ['бордовый', 'red'],
    ['голубой', 'light-blue'],
    ['синий', 'blue'],
  ])('%s → %s', (text, code) => {
    expect(guessColorCode(text)).toBe(code);
  });

  it('returns null for unknown colours', () => {
    expect(guessColorCode('кроссовки')).toBeNull();
  });
});

describe('matchSizeCode', () => {
  it('maps letters, Russian sizes and ranges for clothing', () => {
    expect(matchSizeCode('M', 'CLOTHING_INT', CLOTHING)).toBe('M');
    expect(matchSizeCode('xl', 'CLOTHING_INT', CLOTHING)).toBe('XL');
    expect(matchSizeCode('2XL', 'CLOTHING_INT', CLOTHING)).toBe('XXL');
    expect(matchSizeCode('46', 'CLOTHING_INT', CLOTHING)).toBe('M');
    expect(matchSizeCode('44-46', 'CLOTHING_INT', CLOTHING)).toBe('S');
    expect(matchSizeCode('L/48', 'CLOTHING_INT', CLOTHING)).toBe('L');
    expect(matchSizeCode('one size', 'CLOTHING_INT', CLOTHING)).toBeNull();
  });

  it('maps whole EU shoe sizes only', () => {
    expect(matchSizeCode('42', 'SHOES_EU', SHOES)).toBe('42');
    expect(matchSizeCode('EU 39', 'SHOES_EU', SHOES)).toBe('39');
    expect(matchSizeCode('42.5', 'SHOES_EU', SHOES)).toBeNull();
    expect(matchSizeCode('41-42', 'SHOES_EU', SHOES)).toBeNull();
    expect(matchSizeCode('50', 'SHOES_EU', SHOES)).toBeNull();
  });

  it('maps kids heights', () => {
    expect(matchSizeCode('110', 'KIDS_HEIGHT', KIDS)).toBe('110');
    expect(matchSizeCode('110-116', 'KIDS_HEIGHT', KIDS)).toBe('110');
    expect(matchSizeCode('111', 'KIDS_HEIGHT', KIDS)).toBeNull();
  });
});

describe('splitTrailingSize and groupBySize', () => {
  it('splits a size off the end of a model name', () => {
    expect(splitTrailingSize('Кроссовки Nike Air белые 42')).toEqual({
      base: 'Кроссовки Nike Air белые',
      size: '42',
    });
    expect(splitTrailingSize('Футболка Basic (XL)')).toEqual({
      base: 'Футболка Basic',
      size: 'XL',
    });
    expect(splitTrailingSize('Сумка')).toEqual({ base: 'Сумка', size: null });
  });

  it('groups offers only when several share a name', () => {
    const groups = groupBySize([
      { name: 'Кроссовки Nike Air 41', sku: 'a' },
      { name: 'Кроссовки Nike Air 42', sku: 'b' },
      { name: 'Nike Air Max 90', sku: 'c' },
      { name: 'Сумка кожаная', sku: 'd' },
    ]);
    expect(groups.map((g) => [g.name, g.items.map((i) => i.size)])).toEqual([
      ['Кроссовки Nike Air', ['41', '42']],
      ['Nike Air Max 90', [null]],
      ['Сумка кожаная', [null]],
    ]);
  });
});

describe('prices', () => {
  it('rounds the sale price down to …90 tenge', () => {
    expect(salePriceFromPercent(2_500_000, 40)).toBe(1_499_000);
    expect(salePriceFromPercent(1_499_000, 30)).toBe(1_049_000);
    expect(salePriceFromPercent(120_000, 50)).toBe(60_000);
  });

  it('never gives a smaller discount than asked', () => {
    for (const base of [99_900, 1_000_000, 1_234_500, 4_999_000]) {
      for (const percent of [30, 40, 50, 70]) {
        const sale = salePriceFromPercent(base, percent);
        expect(sale % 100).toBe(0);
        expect(Math.floor(((base - sale) * 100) / base)).toBeGreaterThanOrEqual(percent);
      }
    }
  });

  it('parses tenge amounts', () => {
    expect(parseTengeAmount('12 990,00')).toBe(1_299_000);
    expect(parseTengeAmount('12990 ₸')).toBe(1_299_000);
    expect(parseTengeAmount(15000)).toBe(1_500_000);
    expect(parseTengeAmount('бесплатно')).toBeNull();
    expect(parseTengeAmount('0')).toBeNull();
  });
});
