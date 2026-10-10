import { parseTengeAmount } from '@lastsize/domain';
import { parse as parseCsv } from 'csv-parse/sync';
import { readSheet } from 'read-excel-file/node';
import {
  clip,
  type ImportCandidate,
  MAX_IMPORT_ROWS,
  MAX_PHOTOS,
  SourceRejectedError,
} from './candidate';
import { parseKaspiXml } from './kaspi-xml';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_LINES = 10_000;
/** An .xlsx is a zip; refuse archives that would unpack into more than this. */
const MAX_UNZIPPED_BYTES = 60 * 1024 * 1024;

type Column =
  | 'article'
  | 'title'
  | 'brand'
  | 'category'
  | 'gender'
  | 'color'
  | 'size'
  | 'quantity'
  | 'originalPrice'
  | 'salePrice'
  | 'photos'
  | 'description'
  | 'composition';

/** Header spellings (lowercase, letters and digits only) seen in seller spreadsheets and WB/Kaspi exports. */
const HEADERS: Record<Column, string[]> = {
  article: ['артикул', 'артикулпродавца', 'sku', 'vendorcode', 'код', 'кодтовара'],
  title: ['название', 'наименование', 'модель', 'title', 'name', 'model'],
  brand: ['бренд', 'brand', 'марка', 'производитель'],
  category: ['категория', 'предмет', 'category', 'типтовара', 'вид'],
  gender: ['пол', 'gender'],
  color: ['цвет', 'color', 'colour'],
  size: ['размер', 'size', 'размерпроизводителя'],
  quantity: ['количество', 'остаток', 'остатки', 'колво', 'qty', 'quantity', 'stock'],
  originalPrice: ['ценадоскидки', 'цена', 'price', 'стараяцена', 'розничнаяцена'],
  salePrice: ['ценасоскидкой', 'ценараспродажи', 'saleprice', 'новаяцена', 'ценапососкидкой'],
  photos: ['фото', 'фотографии', 'photo', 'photos', 'images', 'изображения', 'ссылкинафото'],
  description: ['описание', 'description'],
  composition: ['состав', 'composition', 'материал'],
};

function headerKey(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]/g, '');
}

/** Sum of the uncompressed sizes in the zip's central directory, read without unpacking. */
function unzippedSize(buffer: Buffer): number | null {
  const minEnd = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minEnd; offset--) {
    if (buffer.readUInt32LE(offset) !== 0x06054b50) continue;
    const entries = buffer.readUInt16LE(offset + 10);
    let pointer = buffer.readUInt32LE(offset + 16);
    let total = 0;
    for (let i = 0; i < entries; i++) {
      if (pointer + 46 > buffer.length || buffer.readUInt32LE(pointer) !== 0x02014b50) return null;
      total += buffer.readUInt32LE(pointer + 24);
      pointer +=
        46 +
        buffer.readUInt16LE(pointer + 28) +
        buffer.readUInt16LE(pointer + 30) +
        buffer.readUInt16LE(pointer + 32);
    }
    return total;
  }
  return null;
}

function decodeText(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    // Excel in Russian locale saves CSV as Windows-1251.
    return new TextDecoder('windows-1251').decode(buffer);
  }
}

async function readTable(buffer: Buffer): Promise<unknown[][]> {
  const isZip = buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50;
  if (isZip) {
    const unzipped = unzippedSize(buffer);
    if (unzipped === null) throw new SourceRejectedError('file.unreadable');
    if (unzipped > MAX_UNZIPPED_BYTES) throw new SourceRejectedError('file.tooLarge');
    try {
      return await readSheet(buffer);
    } catch {
      throw new SourceRejectedError('file.unreadable');
    }
  }
  try {
    return parseCsv(decodeText(buffer), {
      bom: true,
      delimiter: [';', ',', '\t'],
      relax_column_count: true,
      skip_empty_lines: true,
      to_line: MAX_FILE_LINES + 1,
    }) as string[][];
  } catch {
    throw new SourceRejectedError('file.unreadable');
  }
}

/**
 * Seller spreadsheet (.xlsx or .csv), one size per line. Lines with the same article (or title)
 * and colour become one product. A Kaspi XML price list uploaded as a file is accepted too.
 */
export async function parseImportFile(buffer: Buffer): Promise<ImportCandidate[]> {
  if (buffer.length === 0) throw new SourceRejectedError('source.empty');
  const head = buffer
    .subarray(0, 512)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart();
  if (head.startsWith('<')) return parseKaspiXml(buffer);

  const table = await readTable(buffer);
  const headerIndex = table.findIndex((row) =>
    row.some((cell) => HEADERS.title.includes(headerKey(cell))),
  );
  if (headerIndex < 0 || headerIndex > 10) throw new SourceRejectedError('file.noTitleColumn');
  const columns = new Map<Column, number>();
  table[headerIndex]!.forEach((cell, index) => {
    const key = headerKey(cell);
    for (const [column, names] of Object.entries(HEADERS) as [Column, string[]][]) {
      if (names.includes(key) && !columns.has(column)) columns.set(column, index);
    }
  });
  const get = (row: unknown[], column: Column) => {
    const index = columns.get(column);
    return index === undefined ? null : row[index];
  };

  const groups = new Map<string, ImportCandidate>();
  for (const row of table.slice(headerIndex + 1)) {
    const title = clip(get(row, 'title'), 120);
    if (!title) continue;
    const article = clip(get(row, 'article'), 60);
    const color = clip(get(row, 'color'), 60);
    const key = `${(article ?? title).toLowerCase()}|${(color ?? '').toLowerCase()}`;
    let candidate = groups.get(key);
    if (!candidate) {
      const photos = String(get(row, 'photos') ?? '')
        .split(/[\s,;]+/)
        .filter((url) => /^https?:\/\//i.test(url))
        .slice(0, MAX_PHOTOS);
      candidate = {
        externalId: article ?? title,
        data: {
          title,
          brand: clip(get(row, 'brand'), 60),
          description: clip(get(row, 'description'), 4000),
          composition: clip(get(row, 'composition'), 500),
          article,
          sourceCategory: clip(get(row, 'category'), 100),
          sourceColor: color,
          sourceGender: clip(get(row, 'gender'), 40),
          photos,
          sizes: [],
        },
        originalPrice: parseTengeAmount(get(row, 'originalPrice')),
        salePrice: parseTengeAmount(get(row, 'salePrice')),
        externalPrice: null,
      };
      groups.set(key, candidate);
      if (groups.size > MAX_IMPORT_ROWS) throw new SourceRejectedError('source.tooManyRows');
    }
    const quantity = Math.floor(Number(String(get(row, 'quantity') ?? '0').replace(',', '.')));
    candidate.data.sizes.push({
      label: clip(get(row, 'size'), 20),
      quantity: Number.isFinite(quantity) && quantity > 0 ? Math.min(quantity, 9_999) : 0,
      externalSizeId: null,
      barcode: null,
    });
  }
  if (groups.size === 0) throw new SourceRejectedError('source.empty');
  return [...groups.values()];
}
