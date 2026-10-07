import { Module } from '@nestjs/common';
import { AdminStoresController } from './admin-stores.controller';
import { SellerStoresController } from './seller-stores.controller';
import { StoresService } from './stores.service';

@Module({
  controllers: [SellerStoresController, AdminStoresController],
  providers: [StoresService],
  exports: [StoresService],
})
export class StoresModule {}
