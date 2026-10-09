import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Media } from '@lastsize/contracts';
import { type Database, storeMedia } from '@lastsize/db';
import { DATABASE } from '../infrastructure/infrastructure.module';
import { IMAGE_WIDTHS, type ImageProcessor } from './image-processor';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage';

export const IMAGE_PROCESSOR = Symbol('IMAGE_PROCESSOR');

const IMMUTABLE = 'public, max-age=31536000, immutable';
const CONTENT_TYPES = { avif: 'image/avif', webp: 'image/webp' } as const;

/** Public URL prefix of processed images; Caddy (and the dev proxy) serve /media from the public bucket. */
export function mediaUrl(baseKey: string): string {
  return `/media/${baseKey}/`;
}

export function toMedia(row: {
  id: string;
  baseKey: string;
  width: number;
  height: number;
}): Media {
  return {
    id: row.id,
    url: mediaUrl(row.baseKey),
    widths: [...IMAGE_WIDTHS],
    width: row.width,
    height: row.height,
  };
}

@Injectable()
export class MediaService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(IMAGE_PROCESSOR) private readonly processor: ImageProcessor,
  ) {}

  async upload(storeId: string, userId: string, file: Buffer): Promise<Media> {
    const processed = await this.processor.process(file);
    const mediaId = randomUUID();
    const baseKey = `products/${storeId}/${mediaId}`;
    const originalKey = `originals/${storeId}/${mediaId}`;
    const publicKeys = processed.variants.map(
      (variant) => `${baseKey}/${variant.width}.${variant.format}`,
    );

    try {
      // The original stays private (it may still carry camera metadata) for future reprocessing.
      await this.storage.put(
        this.storage.privateBucket,
        originalKey,
        file,
        'application/octet-stream',
      );
      await Promise.all(
        processed.variants.map((variant, index) =>
          this.storage.put(
            this.storage.publicBucket,
            publicKeys[index]!,
            variant.body,
            CONTENT_TYPES[variant.format],
            IMMUTABLE,
          ),
        ),
      );
      const [row] = await this.db
        .insert(storeMedia)
        .values({
          id: mediaId,
          storeId,
          uploadedBy: userId,
          baseKey,
          width: processed.width,
          height: processed.height,
          bytes: file.length,
        })
        .returning();
      return toMedia(row!);
    } catch (error) {
      await Promise.allSettled([
        this.storage.deleteMany(this.storage.publicBucket, publicKeys),
        this.storage.deleteMany(this.storage.privateBucket, [originalKey]),
      ]);
      throw error;
    }
  }
}
