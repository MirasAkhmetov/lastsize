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
  adminProductListQuerySchema,
  type ProductList,
  productListSchema,
  storeReasonRequestSchema,
} from '@lastsize/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth, RequirePermissions } from '../auth/decorators';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { ProductsService } from './products.service';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

/** Post-moderation: products go live at once, admins review the feed and remove what breaks the rules. */
@Controller('admin/products')
export class AdminProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequirePermissions('admin:access', 'product:remove')
  async feed(
    @Query(new ZodValidationPipe(adminProductListQuerySchema))
    query: z.output<typeof adminProductListQuerySchema>,
  ): Promise<ProductList> {
    return productListSchema.parse(
      await this.productsService.adminFeed(query.filter, query.limit, query.offset),
    );
  }

  @Post(':productId/remove')
  @HttpCode(204)
  @RequirePermissions('admin:access', 'product:remove')
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('productId', uuid) productId: string,
    @Body(new ZodValidationPipe(storeReasonRequestSchema))
    body: z.output<typeof storeReasonRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.productsService.adminAction(
      productId,
      'remove',
      { userId: auth.user.id, request },
      body.reason,
    );
  }

  @Post(':productId/restore')
  @HttpCode(204)
  @RequirePermissions('admin:access', 'product:remove')
  async restore(
    @CurrentAuth() auth: AuthContext,
    @Param('productId', uuid) productId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.productsService.adminAction(productId, 'restore', { userId: auth.user.id, request });
  }

  @Post(':productId/clear-flag')
  @HttpCode(204)
  @RequirePermissions('admin:access', 'product:remove')
  async clearFlag(
    @CurrentAuth() auth: AuthContext,
    @Param('productId', uuid) productId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.productsService.adminAction(productId, 'clearFlag', {
      userId: auth.user.id,
      request,
    });
  }
}
