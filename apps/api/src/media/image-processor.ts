import sharp from 'sharp';

export const IMAGE_WIDTHS = [320, 640, 1080] as const;
export const IMAGE_FORMATS = ['avif', 'webp'] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

const ACCEPTED_INPUT = new Set(['jpeg', 'png', 'webp', 'avif', 'heif']);
const MAX_PIXELS = 40_000_000; // ~ a 48 MP phone photo is rejected, 12–24 MP is fine
const MIN_SIDE = 400;
const MAX_CONCURRENT = 2;

export class ImageRejectedError extends Error {
  constructor(readonly code: 'image.unsupported' | 'image.tooSmall' | 'image.tooLarge') {
    super(code);
    this.name = 'ImageRejectedError';
  }
}

export interface ProcessedImage {
  width: number;
  height: number;
  variants: { width: number; format: ImageFormat; body: Buffer }[];
}

/**
 * Turns an uploaded photo into web versions. The real type is detected from the file content,
 * not from its name or Content-Type. EXIF (including GPS location) is removed, orientation is
 * applied, and images are never enlarged. At most two images are processed at once so uploads
 * cannot starve the API of CPU.
 */
export class ImageProcessor {
  private running = 0;
  private readonly queue: (() => void)[] = [];

  async process(input: Buffer): Promise<ProcessedImage> {
    await this.acquire();
    try {
      return await this.run(input);
    } finally {
      this.release();
    }
  }

  private async run(input: Buffer): Promise<ProcessedImage> {
    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      throw new ImageRejectedError(
        /pixel limit/i.test(message) ? 'image.tooLarge' : 'image.unsupported',
      );
    }
    if (!metadata.format || !ACCEPTED_INPUT.has(metadata.format))
      throw new ImageRejectedError('image.unsupported');

    // Apply EXIF orientation once; metadata (EXIF, GPS, XMP) is not copied to the output.
    const normalized = await sharp(input, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .toBuffer({ resolveWithObject: true });
    const { width, height } = normalized.info;
    if (Math.min(width, height) < MIN_SIDE) throw new ImageRejectedError('image.tooSmall');

    const variants: ProcessedImage['variants'] = [];
    for (const targetWidth of IMAGE_WIDTHS) {
      const resized = sharp(normalized.data).resize({
        width: targetWidth,
        withoutEnlargement: true,
      });
      variants.push({
        width: targetWidth,
        format: 'avif',
        body: await resized.clone().avif({ quality: 50, effort: 4 }).toBuffer(),
      });
      variants.push({
        width: targetWidth,
        format: 'webp',
        body: await resized.clone().webp({ quality: 76 }).toBuffer(),
      });
    }
    return { width, height, variants };
  }

  private acquire(): Promise<void> {
    if (this.running < MAX_CONCURRENT) {
      this.running += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(() => resolve()));
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.running -= 1;
  }
}
