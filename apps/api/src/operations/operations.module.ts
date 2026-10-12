import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { AnalyticsService } from './analytics.service';
import { AdminOperationsController, StoreAnalyticsController } from './operations.controller';
import { OperationsService } from './operations.service';

@Module({
  imports: [OrdersModule],
  controllers: [AdminOperationsController, StoreAnalyticsController],
  providers: [OperationsService, AnalyticsService],
})
export class OperationsModule {}
