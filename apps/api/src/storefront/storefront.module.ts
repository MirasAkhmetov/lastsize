import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { StorefrontController } from './storefront.controller';

@Module({ controllers: [StorefrontController], providers: [CatalogService] })
export class StorefrontModule {}
