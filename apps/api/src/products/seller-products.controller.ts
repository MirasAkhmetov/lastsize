import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  createProductRequestSchema,
  productActionRequestSchema,
  type ProductList,
  productListSchema,
  type SellerProduct,
  sellerProductListQuerySchema,
  sellerProductSchema,
  updateProductRequestSchema,
} from '@lastsize/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth, RequireStoreAccess } from '../auth/decorators';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { ProductsService } from './products.service';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

/** Products of one store. Every query is scoped by the store id the guard verified. */
@Controller('seller/stores/:storeId/products')
export class SellerProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequireStoreAccess('product:read_store')
  async list(
    @Param('storeId') storeId: string,
    @Query(new ZodValidationPipe(sellerProductListQuerySchema))
    query: z.output<typeof sellerProductListQuerySchema>,
  ): Promise<ProductList> {
    return productListSchema.parse(
      await this.productsService.sellerList(storeId, query.status, query.limit, query.offset),
    );
  }

  @Post()
  @RequireStoreAccess('product:write')
  async create(
    @CurrentAuth() auth: AuthContext,
    @Param('storeId') storeId: string,
    @Body(new ZodValidationPipe(createProductRequestSchema))
    body: z.output<typeof createProductRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<SellerProduct> {
    const productId = await this.productsService.create(storeId, body, {
      userId: auth.user.id,
      request,
    });
    return sellerProductSchema.parse(await this.productsService.sellerProduct(storeId, productId));
  }

  @Get(':productId')
  @RequireStoreAccess('product:read_store')
  async one(
    @Param('storeId') storeId: string,
    @Param('productId', uuid) productId: string,
  ): Promise<SellerProduct> {
    return sellerProductSchema.parse(await this.productsService.sellerProduct(storeId, productId));
  }

  @Patch(':productId')
  @RequireStoreAccess('product:write')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('storeId') storeId: string,
    @Param('productId', uuid) productId: string,
    @Body(new ZodValidationPipe(updateProductRequestSchema))
    body: z.output<typeof updateProductRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<SellerProduct> {
    await this.productsService.update(storeId, productId, body, { userId: auth.user.id, request });
    return sellerProductSchema.parse(await this.productsService.sellerProduct(storeId, productId));
  }

  @Post(':productId/status')
  @HttpCode(200)
  @RequireStoreAccess('product:write')
  async status(
    @CurrentAuth() auth: AuthContext,
    @Param('storeId') storeId: string,
    @Param('productId', uuid) productId: string,
    @Body(new ZodValidationPipe(productActionRequestSchema))
    body: z.output<typeof productActionRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<SellerProduct> {
    await this.productsService.sellerAction(storeId, productId, body.action, {
      userId: auth.user.id,
      request,
    });
    return sellerProductSchema.parse(await this.productsService.sellerProduct(storeId, productId));
  }
}
