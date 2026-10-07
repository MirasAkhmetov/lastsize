import { Body, Controller, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import {
  createStoreRequestSchema,
  type SellerStore,
  sellerStoreSchema,
  type StoreDetail,
  storeDetailSchema,
  updateStoreRequestSchema,
} from '@lastsize/contracts';
import { type Database, eq, storeMembers, stores } from '@lastsize/db';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth, RequireStoreAccess } from '../auth/decorators';
import { DATABASE } from '../infrastructure/infrastructure.module';
import { RateLimiterService } from '../security/rate-limiter.service';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { StoresService } from './stores.service';

const CREATE_LIMIT = { name: 'store:create', limit: 5, windowSeconds: 60 * 60 };

@Controller('seller/stores')
export class SellerStoresController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly storesService: StoresService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  /** Stores the signed-in user belongs to, including blocked ones (so the seller sees why). */
  @Get()
  async mine(@CurrentAuth() auth: AuthContext): Promise<SellerStore[]> {
    const rows = await this.db
      .select({
        id: stores.id,
        slug: stores.slug,
        name: stores.name,
        status: stores.status,
        role: storeMembers.role,
        reason: stores.rejectionReason,
      })
      .from(storeMembers)
      .innerJoin(stores, eq(stores.id, storeMembers.storeId))
      .where(eq(storeMembers.userId, auth.user.id));
    return rows.map(({ reason, ...row }) =>
      sellerStoreSchema.parse({
        ...row,
        statusReason: row.status === 'REJECTED' || row.status === 'BLOCKED' ? reason : null,
      }),
    );
  }

  @Post()
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createStoreRequestSchema))
    body: z.output<typeof createStoreRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<StoreDetail> {
    await this.rateLimiter.consume(CREATE_LIMIT, auth.user.id);
    const storeId = await this.storesService.create(body, { userId: auth.user.id, request });
    return storeDetailSchema.parse(await this.storesService.sellerDetail(storeId, auth.user.id));
  }

  @Get(':storeId')
  @RequireStoreAccess()
  async one(
    @CurrentAuth() auth: AuthContext,
    @Param('storeId') storeId: string,
  ): Promise<StoreDetail> {
    return storeDetailSchema.parse(await this.storesService.sellerDetail(storeId, auth.user.id));
  }

  @Patch(':storeId')
  @RequireStoreAccess('store:manage')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('storeId') storeId: string,
    @Body(new ZodValidationPipe(updateStoreRequestSchema))
    body: z.output<typeof updateStoreRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<StoreDetail> {
    await this.storesService.update(storeId, body, { userId: auth.user.id, request });
    return storeDetailSchema.parse(await this.storesService.sellerDetail(storeId, auth.user.id));
  }
}
