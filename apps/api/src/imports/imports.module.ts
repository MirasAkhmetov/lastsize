import { Module } from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../config/api-env';
import { ProductsModule } from '../products/products.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { IntegrationsService } from './integrations.service';
import { HttpWildberriesApi, WILDBERRIES_API } from './wildberries.client';

@Module({
  imports: [ProductsModule],
  controllers: [ImportsController],
  providers: [
    ImportsService,
    IntegrationsService,
    {
      provide: WILDBERRIES_API,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) => new HttpWildberriesApi(env),
    },
  ],
})
export class ImportsModule {}
