import { Module } from '@nestjs/common';
import { SellerStoresController } from './seller-stores.controller';

@Module({ controllers: [SellerStoresController] })
export class SellerModule {}
