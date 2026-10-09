import { Global, Inject, Module, type OnModuleInit } from '@nestjs/common';
import type { Logger } from '@lastsize/logger';
import { API_ENV, type ApiEnv } from '../config/api-env';
import { APP_LOGGER } from '../logging';
import { ImageProcessor } from './image-processor';
import { MediaController } from './media.controller';
import { IMAGE_PROCESSOR, MediaService } from './media.service';
import { OBJECT_STORAGE, type ObjectStorage, S3ObjectStorage } from './object-storage';

@Global()
@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    {
      provide: OBJECT_STORAGE,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) => new S3ObjectStorage(env),
    },
    { provide: IMAGE_PROCESSOR, useValue: new ImageProcessor() },
  ],
  exports: [MediaService, OBJECT_STORAGE],
})
export class MediaModule implements OnModuleInit {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Buckets are created on first start. If storage is down, the API still starts (everything
   * except photo upload works) and the buckets are created on the first upload.
   */
  async onModuleInit(): Promise<void> {
    await this.storage.ensureBuckets().catch((error: unknown) => {
      this.logger.warn(
        { err: error },
        'object storage unavailable at startup; will retry on first upload',
      );
    });
  }
}
