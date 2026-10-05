import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller';
import { CustomerSessionService } from './customer-session.service';

@Module({
  controllers: [CustomerController],
  providers: [CustomerSessionService],
  exports: [CustomerSessionService],
})
export class CustomerModule {}
