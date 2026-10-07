/** Russian and Kazakh Cyrillic to Latin for readable URLs: «Қызыл Әлем» → "kyzyl-alem". */
const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  ә: 'a',
  ғ: 'g',
  қ: 'k',
  ң: 'n',
  ө: 'o',
  ұ: 'u',
  ү: 'u',
  һ: 'h',
  і: 'i',
  '№': ' ',
};

const MAX_LENGTH = 60;

export function slugify(input: string): string {
  const latin = [...input.toLowerCase().normalize('NFC')]
    .map((char) => TRANSLIT[char] ?? char)
    .join('')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
  const slug = latin
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LENGTH)
    .replace(/-+$/g, '');
  return slug || 'store';
}

/** Appends -2, -3, … until `isTaken` returns false. */
export async function uniqueSlug(
  base: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  const root = slugify(base);
  if (!(await isTaken(root))) return root;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${root.slice(0, MAX_LENGTH - String(suffix).length - 1)}-${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error(`No free slug for "${base}"`);
}
