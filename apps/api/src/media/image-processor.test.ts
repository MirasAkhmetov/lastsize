import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ImageProcessor, ImageRejectedError } from './image-processor';

const processor = new ImageProcessor();

async function photo(
  width: number,
  height: number,
  options: { exif?: boolean; orientation?: number } = {},
) {
  let image = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 80, b: 60 } },
  }).jpeg();
  if (options.exif || options.orientation) {
    image = image.withMetadata({
      ...(options.orientation ? { orientation: options.orientation } : {}),
      ...(options.exif
        ? { exif: { IFD0: { Artist: 'Seller phone', Copyright: 'secret-location' } } }
        : {}),
    });
  }
  return image.toBuffer();
}

describe('ImageProcessor', () => {
  it('produces AVIF and WebP at 320, 640 and 1080 px', async () => {
    const result = await processor.process(await photo(1600, 2000));
    expect(result).toMatchObject({ width: 1600, height: 2000 });
    expect(result.variants.map((v) => `${v.width}.${v.format}`)).toEqual([
      '320.avif',
      '320.webp',
      '640.avif',
      '640.webp',
      '1080.avif',
      '1080.webp',
    ]);
    const largest = await sharp(
      result.variants.find((v) => v.width === 1080 && v.format === 'webp')!.body,
    ).metadata();
    expect(largest).toMatchObject({ format: 'webp', width: 1080, height: 1350 });
  });

  it('removes EXIF metadata', async () => {
    const result = await processor.process(await photo(800, 1000, { exif: true }));
    for (const variant of result.variants) {
      const metadata = await sharp(variant.body).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(variant.body.includes(Buffer.from('secret-location'))).toBe(false);
    }
  });

  it('applies the camera orientation', async () => {
    // Orientation 6 = the camera was rotated 90°: a 1000×800 sensor image is really portrait.
    const result = await processor.process(await photo(1000, 800, { orientation: 6 }));
    expect(result).toMatchObject({ width: 800, height: 1000 });
  });

  it('never enlarges small photos', async () => {
    const result = await processor.process(await photo(500, 600));
    const largest = await sharp(result.variants.find((v) => v.width === 1080)!.body).metadata();
    expect(largest.width).toBe(500);
  });

  it('rejects files that are not images, whatever their name', async () => {
    await expect(processor.process(Buffer.from('<?php system($_GET["c"]); ?>'))).rejects.toEqual(
      new ImageRejectedError('image.unsupported'),
    );
    const gif = await sharp({
      create: { width: 500, height: 500, channels: 3, background: '#fff' },
    })
      .gif()
      .toBuffer();
    await expect(processor.process(gif)).rejects.toEqual(
      new ImageRejectedError('image.unsupported'),
    );
  });

  it('rejects photos that are too small to show', async () => {
    await expect(processor.process(await photo(300, 900))).rejects.toEqual(
      new ImageRejectedError('image.tooSmall'),
    );
  });
});
