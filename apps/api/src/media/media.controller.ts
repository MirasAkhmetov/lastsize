import { Controller, HttpException, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { type Media, mediaSchema } from '@lastsize/contracts';
import type { FastifyRequest } from 'fastify';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth, RequireStoreAccess } from '../auth/decorators';
import { RateLimiterService } from '../security/rate-limiter.service';
import { ValidationFailedException } from '../security/zod-validation.pipe';
import { ImageRejectedError } from './image-processor';
import { MediaService } from './media.service';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const UPLOAD_LIMIT = { name: 'media:upload', limit: 300, windowSeconds: 60 * 60 };

@Controller('seller/stores/:storeId/media')
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  /** One photo per request, field "file". The file type is checked from its content. */
  @Post()
  @RequireStoreAccess('product:write')
  async upload(
    @CurrentAuth() auth: AuthContext,
    @Param('storeId') storeId: string,
    @Req() request: FastifyRequest,
  ): Promise<Media> {
    await this.rateLimiter.consume(UPLOAD_LIMIT, storeId);
    if (!request.isMultipart())
      throw new ValidationFailedException([{ path: 'file', message: 'image.required' }]);
    const part = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
    if (!part || part.fieldname !== 'file')
      throw new ValidationFailedException([{ path: 'file', message: 'image.required' }]);
    const buffer = await part.toBuffer().catch(() => {
      throw new HttpException('Файл больше 15 МБ', HttpStatus.PAYLOAD_TOO_LARGE);
    });
    if (part.file.truncated)
      throw new HttpException('Файл больше 15 МБ', HttpStatus.PAYLOAD_TOO_LARGE);
    try {
      return mediaSchema.parse(await this.media.upload(storeId, auth.user.id, buffer));
    } catch (error) {
      if (error instanceof ImageRejectedError)
        throw new ValidationFailedException([{ path: 'file', message: error.code }]);
      throw error;
    }
  }
}
