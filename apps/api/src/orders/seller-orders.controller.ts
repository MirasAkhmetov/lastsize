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
  returnRequestSchema,
  type SellerOrderDetail,
  sellerOrderDetailSchema,
  type SellerOrderList,
  sellerOrderListQuerySchemaWithSearch,
  sellerOrderListSchema,
  storeActionRequestSchema,
} from '@lastsize/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth, RequireStoreAccess } from '../auth/decorators';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { OrdersService } from './orders.service';
import { StoreOrdersService } from './store-orders.service';

/** Orders of one store; every query is scoped by the store id the guard verified. */
@Controller('seller/stores/:storeId/orders')
export class SellerOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly storeOrders: StoreOrdersService,
  ) {}

  @Get()
  @RequireStoreAccess('order:read_store')
  async list(
    @Param('storeId') storeId: string,
    @Query(new ZodValidationPipe(sellerOrderListQuerySchemaWithSearch))
    query: z.output<typeof sellerOrderListQuerySchemaWithSearch>,
  ): Promise<SellerOrderList> {
    return sellerOrderListSchema.parse(
      await this.orders.sellerList(storeId, query.status, query.limit, query.offset, query.q),
    );
  }

  @Get(':sellerOrderId')
  @RequireStoreAccess('order:read_store')
  async detail(
    @Param('storeId') storeId: string,
    @Param('sellerOrderId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ): Promise<SellerOrderDetail> {
    return sellerOrderDetailSchema.parse(await this.orders.sellerDetail(storeId, id));
  }

  /** Confirm, ready for pickup, paid, courier called, handed over, completed or cancelled. */
  @Post(':sellerOrderId/actions')
  @HttpCode(200)
  @RequireStoreAccess('order:transition')
  async act(
    @CurrentAuth() auth: AuthContext,
    @Param('storeId') storeId: string,
    @Param('sellerOrderId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body(new ZodValidationPipe(storeActionRequestSchema))
    body: z.output<typeof storeActionRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<SellerOrderDetail> {
    await this.storeOrders.act(storeId, id, body, { userId: auth.user.id, request });
    return sellerOrderDetailSchema.parse(await this.orders.sellerDetail(storeId, id));
  }

  /** Goods brought back within 14 days: accept (back on sale) or refuse with a reason. */
  @Post(':sellerOrderId/returns')
  @HttpCode(200)
  @RequireStoreAccess('order:transition')
  async processReturn(
    @CurrentAuth() auth: AuthContext,
    @Param('storeId') storeId: string,
    @Param('sellerOrderId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body(new ZodValidationPipe(returnRequestSchema)) body: z.output<typeof returnRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<SellerOrderDetail> {
    await this.storeOrders.processReturn(storeId, id, body, { userId: auth.user.id, request });
    return sellerOrderDetailSchema.parse(await this.orders.sellerDetail(storeId, id));
  }
}
