import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  adminCancelRequestSchema,
  type AdminOrderDetail,
  adminOrderDetailSchema,
  type AdminOrderList,
  adminOrderListQuerySchema,
  adminOrderListSchema,
  analyticsQuerySchema,
  blockedPhoneListSchema,
  blockPhoneRequestSchema,
  integrationHealthListSchema,
  kzPhoneSchema,
  platformAnalyticsSchema,
  storeAnalyticsSchema,
  suspiciousPhoneListSchema,
} from '@lastsize/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth, RequirePermissions, RequireStoreAccess } from '../auth/decorators';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { AnalyticsService } from './analytics.service';
import { OperationsService } from './operations.service';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@Controller('admin')
export class AdminOperationsController {
  constructor(
    private readonly operations: OperationsService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Get('analytics')
  @RequirePermissions('order:read_all')
  async platform(
    @Query(new ZodValidationPipe(analyticsQuerySchema))
    query: z.output<typeof analyticsQuerySchema>,
  ) {
    return platformAnalyticsSchema.parse(await this.analytics.platform(query.days));
  }

  @Get('orders')
  @RequirePermissions('order:read_all')
  async orders(
    @Query(new ZodValidationPipe(adminOrderListQuerySchema))
    query: z.output<typeof adminOrderListQuerySchema>,
  ): Promise<AdminOrderList> {
    return adminOrderListSchema.parse(
      await this.operations.orders(query.status, query.q, query.limit, query.offset),
    );
  }

  @Get('orders/:id')
  @RequirePermissions('order:read_all')
  async order(@Param('id', uuid) id: string): Promise<AdminOrderDetail> {
    return adminOrderDetailSchema.parse(await this.operations.order(id));
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('order:manage')
  async cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(adminCancelRequestSchema))
    body: z.output<typeof adminCancelRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<AdminOrderDetail> {
    await this.operations.cancelOrder(id, body.note, { userId: auth.user.id, request });
    return adminOrderDetailSchema.parse(await this.operations.order(id));
  }

  @Get('phones/suspicious')
  @RequirePermissions('phone:block')
  async suspicious() {
    return suspiciousPhoneListSchema.parse(await this.operations.suspiciousPhones());
  }

  @Get('phones/blocked')
  @RequirePermissions('phone:block')
  async blocked() {
    return blockedPhoneListSchema.parse(await this.operations.blockedList());
  }

  @Post('phones/blocked')
  @HttpCode(204)
  @RequirePermissions('phone:block')
  async block(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(blockPhoneRequestSchema))
    body: z.output<typeof blockPhoneRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.operations.block(body.phone, body.reason, { userId: auth.user.id, request });
  }

  @Delete('phones/blocked/:phone')
  @HttpCode(204)
  @RequirePermissions('phone:block')
  async unblock(
    @CurrentAuth() auth: AuthContext,
    @Param('phone', new ZodValidationPipe(kzPhoneSchema)) phone: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.operations.unblock(phone, { userId: auth.user.id, request });
  }

  @Get('integrations')
  @RequirePermissions('order:read_all')
  async integrations() {
    return integrationHealthListSchema.parse(await this.operations.integrationHealth());
  }
}

@Controller('seller/stores/:storeId/analytics')
export class StoreAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  @RequireStoreAccess('order:read_store')
  async store(
    @Param('storeId') storeId: string,
    @Query(new ZodValidationPipe(analyticsQuerySchema))
    query: z.output<typeof analyticsQuerySchema>,
  ) {
    return storeAnalyticsSchema.parse(await this.analytics.store(storeId, query.days));
  }
}
