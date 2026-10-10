import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  type SellerOrderDetail,
  sellerOrderDetailSchema,
  type SellerOrderList,
  sellerOrderListQuerySchema,
  sellerOrderListSchema,
} from '@lastsize/contracts';
import type { z } from 'zod';
import { RequireStoreAccess } from '../auth/decorators';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { OrdersService } from './orders.service';

/** Orders of one store; every query is scoped by the store id the guard verified. */
@Controller('seller/stores/:storeId/orders')
export class SellerOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequireStoreAccess('order:read_store')
  async list(
    @Param('storeId') storeId: string,
    @Query(new ZodValidationPipe(sellerOrderListQuerySchema))
    query: z.output<typeof sellerOrderListQuerySchema>,
  ): Promise<SellerOrderList> {
    return sellerOrderListSchema.parse(
      await this.orders.sellerList(storeId, query.status, query.limit, query.offset),
    );
  }

  @Get(':sellerOrderId')
  @RequireStoreAccess('order:read_store')
  async detail(
    @Param('storeId') storeId: string,
    @Param('sellerOrderId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) sellerOrderId: string,
  ): Promise<SellerOrderDetail> {
    return sellerOrderDetailSchema.parse(await this.orders.sellerDetail(storeId, sellerOrderId));
  }
}
