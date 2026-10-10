import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SourceRejectedError } from './candidate';
import { parseImportFile } from './import-file';
import { parseKaspiXml } from './kaspi-xml';

const KASPI = `<?xml version="1.0" encoding="utf-8"?>
<kaspi_catalog date="string" xmlns="kaspiShopping" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <company>Sneakerhead</company>
  <merchantid>123</merchantid>
  <offers>
    <offer sku="AF1-38">
      <model>Кроссовки Nike Air Force 1 белые 38</model>
      <brand>Nike</brand>
      <availabilities><availability available="yes" storeId="PP1" stockCount="2"/></availabilities>
      <price>45990</price>
    </offer>
    <offer sku="AF1-39">
      <model>Кроссовки Nike Air Force 1 белые 39</model>
      <brand>Nike</brand>
      <availabilities><availability available="no" storeId="PP1" stockCount="4"/></availabilities>
      <price>45990</price>
    </offer>
    <offer sku="AM90">
      <model>Nike Air Max 90</model>
      <brand>Nike</brand>
      <availabilities><availability available="yes" storeId="PP1" stockCount="1"/></availabilities>
      <cityprices>
        <cityprice cityId="710000000">61000</cityprice>
        <cityprice cityId="750000000">59990</cityprice>
      </cityprices>
    </offer>
  </offers>
</kaspi_catalog>`;

function rejection(fn: () => unknown): Promise<string> {
  return Promise.resolve()
    .then(fn)
    .then(
      () => 'no error',
      (error: unknown) => (error instanceof SourceRejectedError ? error.code : String(error)),
    );
}

describe('parseKaspiXml', () => {
  it('groups size offers, reads Almaty prices and available stock', () => {
    const [airForce, airMax] = parseKaspiXml(Buffer.from(KASPI));
    expect(airForce).toMatchObject({
      externalId: 'AF1-38',
      originalPrice: 4_599_000,
      externalPrice: 4_599_000,
      data: { title: 'Кроссовки Nike Air Force 1 белые', brand: 'Nike', photos: [] },
    });
    expect(airForce!.data.sizes).toEqual([
      { label: '38', quantity: 2, externalSizeId: 'AF1-38', barcode: null },
      { label: '39', quantity: 0, externalSizeId: 'AF1-39', barcode: null },
    ]);
    expect(airMax).toMatchObject({
      data: { title: 'Nike Air Max 90' },
      externalPrice: 5_999_000,
    });
    expect(airMax!.data.sizes).toEqual([
      { label: null, quantity: 1, externalSizeId: 'AM90', barcode: null },
    ]);
  });

  it('refuses entity declarations and foreign XML', async () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">]><kaspi_catalog><offers><offer sku="1"><model>&lol;</model></offer></offers></kaspi_catalog>`;
    expect(await rejection(() => parseKaspiXml(Buffer.from(bomb)))).toBe('kaspi.invalidXml');
    expect(await rejection(() => parseKaspiXml(Buffer.from('<rss><channel/></rss>')))).toBe(
      'kaspi.invalidXml',
    );
  });
});

describe('parseImportFile', () => {
  it('reads a Windows-1251 CSV with semicolons and groups sizes by article', async () => {
    const csv = [
      'Артикул;Название;Бренд;Категория;Пол;Цвет;Размер;Кол-во;Цена до скидки;Цена со скидкой;Фото',
      'D-1;Платье миди;Zarina;Платья;Женский;Синий;S;2;"25 000";14 990;https://cdn.example.com/1.jpg https://cdn.example.com/2.jpg',
      'D-1;Платье миди;Zarina;Платья;Женский;Синий;M;1;25000;14990;',
      ';Ремень кожаный;Lacoste;;;Черный;;3;20000;;',
      'D-2;;Zarina;;;;;;;;',
    ].join('\r\n');
    const win1251 = Buffer.from(
      [...csv].map((char) => {
        const code = char.charCodeAt(0);
        if (code < 128) return code;
        if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0;
        if (code === 0x401) return 0xa8;
        if (code === 0x451) return 0xb8;
        throw new Error(`unexpected ${char}`);
      }),
    );
    const [dress, belt, ...rest] = await parseImportFile(win1251);
    expect(rest).toEqual([]);
    expect(dress).toMatchObject({
      externalId: 'D-1',
      originalPrice: 2_500_000,
      salePrice: 1_499_000,
      externalPrice: null,
      data: {
        title: 'Платье миди',
        brand: 'Zarina',
        sourceCategory: 'Платья',
        sourceGender: 'Женский',
        sourceColor: 'Синий',
        photos: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'],
      },
    });
    expect(dress!.data.sizes.map((s) => [s.label, s.quantity])).toEqual([
      ['S', 2],
      ['M', 1],
    ]);
    expect(belt).toMatchObject({
      externalId: 'Ремень кожаный',
      salePrice: null,
      data: { sizes: [{ label: null, quantity: 3 }] },
    });
  });

  it('reads the template sellers download from the import page', async () => {
    const template = readFileSync(
      resolve(__dirname, '../../../web/public/templates/lastsize-import.csv'),
    );
    const rows = await parseImportFile(template);
    expect(
      rows.map((row) => [
        row.externalId,
        row.data.sizes.length,
        row.salePrice,
        row.data.photos.length,
      ]),
    ).toEqual([
      ['NK-AF1-W', 2, 3_599_000, 2],
      ['ZR-DR-12', 2, 1_499_000, 1],
      ['LC-BELT', 1, 1_199_000, 1],
    ]);
  });

  it('accepts a Kaspi XML file and rejects files it cannot read', async () => {
    expect(await parseImportFile(Buffer.from(KASPI))).toHaveLength(2);
    expect(await rejection(() => parseImportFile(Buffer.from('a;b\n1;2')))).toBe(
      'file.noTitleColumn',
    );
    expect(await rejection(() => parseImportFile(Buffer.alloc(0)))).toBe('source.empty');
    const brokenZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]);
    expect(await rejection(() => parseImportFile(brokenZip))).toBe('file.unreadable');
  });
});
