/**
 * Reference data created on first deploy. Rows are inserted only if missing, so admin edits
 * (names, order, activity) made later in the admin panel are never overwritten.
 * Kazakh names should be reviewed by a native speaker before launch.
 */

export const CITIES = [
  { id: 1, slug: 'almaty', nameRu: 'Алматы', nameKk: 'Алматы' },
  { id: 2, slug: 'astana', nameRu: 'Астана', nameKk: 'Астана' },
  { id: 3, slug: 'shymkent', nameRu: 'Шымкент', nameKk: 'Шымкент' },
];

export const SIZE_CHART_IDS = { CLOTHING_INT: 1, SHOES_EU: 2, KIDS_HEIGHT: 3 } as const;

export const SIZE_CHARTS = [
  {
    id: SIZE_CHART_IDS.CLOTHING_INT,
    code: 'CLOTHING_INT',
    nameRu: 'Размеры одежды',
    nameKk: 'Киім өлшемдері',
  },
  {
    id: SIZE_CHART_IDS.SHOES_EU,
    code: 'SHOES_EU',
    nameRu: 'Размеры обуви (EU)',
    nameKk: 'Аяқ киім өлшемдері (EU)',
  },
  {
    id: SIZE_CHART_IDS.KIDS_HEIGHT,
    code: 'KIDS_HEIGHT',
    nameRu: 'Детские размеры (рост, см)',
    nameKk: 'Балалар өлшемдері (бойы, см)',
  },
];

const clothing = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const shoes = Array.from({ length: 27 }, (_, i) => String(20 + i)); // EU 20–46
const kids = [74, 80, 86, 92, 98, 104, 110, 116, 122, 128, 134, 140, 146, 152, 158, 164].map(
  String,
);

/** Size value id = chart id × 1000 + position, stable across environments. */
export const SIZE_VALUES = [
  ...clothing.map((code, i) => ({ chartId: SIZE_CHART_IDS.CLOTHING_INT, code, position: i + 1 })),
  ...shoes.map((code, i) => ({ chartId: SIZE_CHART_IDS.SHOES_EU, code, position: i + 1 })),
  ...kids.map((code, i) => ({ chartId: SIZE_CHART_IDS.KIDS_HEIGHT, code, position: i + 1 })),
].map((value) => ({ id: value.chartId * 1000 + value.position, ...value }));

export const COLORS = [
  { id: 1, code: 'black', nameRu: 'Чёрный', nameKk: 'Қара', hex: '#111111' },
  { id: 2, code: 'white', nameRu: 'Белый', nameKk: 'Ақ', hex: '#ffffff' },
  { id: 3, code: 'grey', nameRu: 'Серый', nameKk: 'Сұр', hex: '#8c8c8c' },
  { id: 4, code: 'beige', nameRu: 'Бежевый', nameKk: 'Беж', hex: '#d9c7a7' },
  { id: 5, code: 'brown', nameRu: 'Коричневый', nameKk: 'Қоңыр', hex: '#6b4423' },
  { id: 6, code: 'red', nameRu: 'Красный', nameKk: 'Қызыл', hex: '#d32f2f' },
  { id: 7, code: 'pink', nameRu: 'Розовый', nameKk: 'Қызғылт', hex: '#f4a6c0' },
  { id: 8, code: 'orange', nameRu: 'Оранжевый', nameKk: 'Қызғылт сары', hex: '#f57c00' },
  { id: 9, code: 'yellow', nameRu: 'Жёлтый', nameKk: 'Сары', hex: '#fbc02d' },
  { id: 10, code: 'green', nameRu: 'Зелёный', nameKk: 'Жасыл', hex: '#388e3c' },
  { id: 11, code: 'light-blue', nameRu: 'Голубой', nameKk: 'Ашық көк', hex: '#81d4fa' },
  { id: 12, code: 'blue', nameRu: 'Синий', nameKk: 'Көк', hex: '#1e5bc6' },
  { id: 13, code: 'navy', nameRu: 'Тёмно-синий', nameKk: 'Қою көк', hex: '#1b2a4a' },
  { id: 14, code: 'purple', nameRu: 'Фиолетовый', nameKk: 'Күлгін', hex: '#7b1fa2' },
  { id: 15, code: 'silver', nameRu: 'Серебристый', nameKk: 'Күміс түсті', hex: '#c0c0c0' },
  { id: 16, code: 'gold', nameRu: 'Золотистый', nameKk: 'Алтын түсті', hex: '#c9a227' },
  { id: 17, code: 'multicolor', nameRu: 'Разноцветный', nameKk: 'Түрлі түсті', hex: null },
];

type CategorySeed = {
  id: number;
  parentId: number | null;
  slug: string;
  nameRu: string;
  nameKk: string;
  sizeChartId: number | null;
  position: number;
};

function children(
  parentId: number,
  sizeChartId: number | null,
  items: [slug: string, nameRu: string, nameKk: string][],
): CategorySeed[] {
  return items.map(([slug, nameRu, nameKk], index) => ({
    id: parentId * 100 + index + 1,
    parentId,
    slug,
    nameRu,
    nameKk,
    sizeChartId,
    position: index + 1,
  }));
}

/**
 * Category tree by product type. Gender is a product attribute, so /catalog/women/dresses is
 * category "dresses" filtered by gender WOMEN. `sizeChartId` is the default size system;
 * kids' clothing uses KIDS_HEIGHT regardless of category.
 */
export const CATEGORIES: CategorySeed[] = [
  {
    id: 1,
    parentId: null,
    slug: 'clothing',
    nameRu: 'Одежда',
    nameKk: 'Киім',
    sizeChartId: SIZE_CHART_IDS.CLOTHING_INT,
    position: 1,
  },
  {
    id: 2,
    parentId: null,
    slug: 'shoes',
    nameRu: 'Обувь',
    nameKk: 'Аяқ киім',
    sizeChartId: SIZE_CHART_IDS.SHOES_EU,
    position: 2,
  },
  {
    id: 3,
    parentId: null,
    slug: 'accessories',
    nameRu: 'Аксессуары',
    nameKk: 'Аксессуарлар',
    sizeChartId: null,
    position: 3,
  },
  ...children(1, SIZE_CHART_IDS.CLOTHING_INT, [
    ['dresses', 'Платья', 'Көйлектер'],
    ['t-shirts', 'Футболки', 'Футболкалар'],
    ['shirts', 'Рубашки', 'Жейделер'],
    ['sweaters', 'Свитеры', 'Свитерлер'],
    ['hoodies', 'Худи и толстовки', 'Худи мен толстовкалар'],
    ['jackets', 'Куртки', 'Күртешелер'],
    ['coats', 'Пальто', 'Пальтолар'],
    ['jeans', 'Джинсы', 'Джинсылар'],
    ['trousers', 'Брюки', 'Шалбарлар'],
    ['skirts', 'Юбки', 'Юбкалар'],
    ['suits', 'Костюмы', 'Костюмдер'],
    ['sportswear', 'Спортивная одежда', 'Спорт киімі'],
  ]),
  ...children(2, SIZE_CHART_IDS.SHOES_EU, [
    ['sneakers', 'Кроссовки', 'Кроссовкалар'],
    ['boots', 'Ботинки', 'Бәтеңкелер'],
    ['high-boots', 'Сапоги', 'Етіктер'],
    ['shoes', 'Туфли', 'Туфлилер'],
    ['sandals', 'Сандалии', 'Сандалдар'],
    ['loafers', 'Лоферы', 'Лоферлер'],
  ]),
  ...children(3, null, [
    ['bags', 'Сумки', 'Сөмкелер'],
    ['backpacks', 'Рюкзаки', 'Рюкзактар'],
    ['belts', 'Ремни', 'Белдіктер'],
    ['hats', 'Головные уборы', 'Бас киімдер'],
    ['scarves', 'Шарфы', 'Шарфтар'],
    ['sunglasses', 'Солнцезащитные очки', 'Күннен қорғайтын көзілдіріктер'],
    ['wallets', 'Кошельки', 'Әмияндар'],
  ]),
];

export const SETTINGS = {
  /** Products with a smaller discount than this cannot be published. */
  'catalog.min_discount_percent': 30,
} as const;

export type SettingKey = keyof typeof SETTINGS;
