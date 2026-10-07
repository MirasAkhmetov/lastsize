import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  type AdminStoreDetail,
  adminStoreDetailSchema,
  type AdminStoreList,
  adminStoreListQuerySchema,
  adminStoreListSchema,
  storeReasonRequestSchema,
  verifyStoreRequestSchema,
} from '@lastsize/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth, RequirePermissions } from '../auth/decorators';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { StoresService } from './stores.service';

/** Store verification queue and moderation actions. Every action is audited. */
@Controller('admin/stores')
export class AdminStoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get()
  @RequirePermissions('admin:access', 'seller:verify')
  async list(
    @Query(new ZodValidationPipe(adminStoreListQuerySchema))
    query: z.output<typeof adminStoreListQuerySchema>,
  ): Promise<AdminStoreList> {
    return adminStoreListSchema.parse(
      await this.storesService.adminList(query.status, query.limit, query.offset),
    );
  }

  @Get(':storeId')
  @RequirePermissions('admin:access', 'seller:verify')
  async one(
    @Param('storeId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) storeId: string,
  ): Promise<AdminStoreDetail> {
    return adminStoreDetailSchema.parse(await this.storesService.adminDetail(storeId));
  }

  @Post(':storeId/verify')
  @HttpCode(204)
  @RequirePermissions('admin:access', 'seller:verify')
  async verify(
    @CurrentAuth() auth: AuthContext,
    @Param('storeId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) storeId: string,
    @Body(new ZodValidationPipe(verifyStoreRequestSchema))
    _body: z.output<typeof verifyStoreRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.storesService.applyAdminTransition(storeId, 'verify', {
      userId: auth.user.id,
      request,
    });
  }

  @Post(':storeId/reject')
  @HttpCode(204)
  @RequirePermissions('admin:access', 'seller:verify')
  async reject(
    @CurrentAuth() auth: AuthContext,
    @Param('storeId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) storeId: string,
    @Body(new ZodValidationPipe(storeReasonRequestSchema))
    body: z.output<typeof storeReasonRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.storesService.applyAdminTransition(
      storeId,
      'reject',
      { userId: auth.user.id, request },
      body.reason,
    );
  }

  @Post(':storeId/block')
  @HttpCode(204)
  @RequirePermissions('admin:access', 'seller:block')
  async block(
    @CurrentAuth() auth: AuthContext,
    @Param('storeId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) storeId: string,
    @Body(new ZodValidationPipe(storeReasonRequestSchema))
    body: z.output<typeof storeReasonRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.storesService.applyAdminTransition(
      storeId,
      'block',
      { userId: auth.user.id, request },
      body.reason,
    );
  }

  @Post(':storeId/unblock')
  @HttpCode(204)
  @RequirePermissions('admin:access', 'seller:block')
  async unblock(
    @CurrentAuth() auth: AuthContext,
    @Param('storeId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) storeId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.storesService.applyAdminTransition(storeId, 'unblock', {
      userId: auth.user.id,
      request,
    });
  }
}
