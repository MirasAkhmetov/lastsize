import { Controller, Get, Header, NotFoundException, Param, Query } from '@nestjs/common';
import {
  type CatalogResponse,
  catalogQuerySchema,
  catalogResponseSchema,
  type ProductDetail,
  productDetailSchema,
  type PublicStore,
  publicStoreSchema,
  type SitemapData,
  sitemapSchema,
} from '@lastsize/contracts';
import type { z } from 'zod';
import { Public } from '../auth/decorators';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { CatalogService } from './catalog.service';

const SHORT_ID = /^[0-9a-z]{8}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Read-only public storefront. Only published products of verified stores are ever returned. */
@Public()
@Controller()
export class StorefrontController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('catalog/products')
  @Header('cache-control', 'public, max-age=30, s-maxage=60')
  async search(
    @Query(new ZodValidationPipe(catalogQuerySchema)) query: z.output<typeof catalogQuerySchema>,
  ): Promise<CatalogResponse> {
    return catalogResponseSchema.parse(await this.catalog.search(query));
  }

  @Get('catalog/products/:shortId')
  @Header('cache-control', 'public, max-age=30, s-maxage=60')
  async product(@Param('shortId') shortId: string): Promise<ProductDetail> {
    if (!SHORT_ID.test(shortId)) throw new NotFoundException('Товар не найден');
    return productDetailSchema.parse(await this.catalog.product(shortId));
  }

  @Get('stores/:slug')
  @Header('cache-control', 'public, max-age=60, s-maxage=300')
  async store(@Param('slug') slug: string): Promise<PublicStore> {
    if (!SLUG.test(slug) || slug.length > 80) throw new NotFoundException('Магазин не найден');
    return publicStoreSchema.parse(await this.catalog.store(slug));
  }

  @Get('catalog/sitemap')
  @Header('cache-control', 'public, max-age=600')
  async sitemap(): Promise<SitemapData> {
    return sitemapSchema.parse(await this.catalog.sitemap());
  }
}
