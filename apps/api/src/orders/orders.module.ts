import { Module } from '@nestjs/common';
import { CustomerModule } from '../customer/customer.module';
import { CartService } from './cart.service';
import { CheckoutService } from './checkout.service';
import { OrderSecrets } from './order-secrets';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { SellerOrdersController } from './seller-orders.controller';

@Module({
  imports: [CustomerModule],
  controllers: [OrdersController, SellerOrdersController],
  providers: [CartService, CheckoutService, OrderSecrets, OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
