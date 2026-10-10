import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { IntegrationsModule } from './integrations.module';

@Module({
  imports: [ProductsModule, IntegrationsModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
