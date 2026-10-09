import { Module } from '@nestjs/common';
import { AdminProductsController } from './admin-products.controller';
import { ProductsService } from './products.service';
import { SellerProductsController } from './seller-products.controller';

@Module({
  controllers: [SellerProductsController, AdminProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
