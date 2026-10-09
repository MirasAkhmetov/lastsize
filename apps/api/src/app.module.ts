import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { Logger } from '@lastsize/logger';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { API_ENV, type ApiEnv } from './config/api-env';
import { CustomerModule } from './customer/customer.module';
import { HealthModule } from './health/health.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { MediaModule } from './media/media.module';
import { ProductsModule } from './products/products.module';
import { APP_LOGGER } from './logging';
import { SecurityModule } from './security/security.module';
import { StoresModule } from './stores/stores.module';

@Global()
@Module({})
class CoreModule {
  static forRoot(env: ApiEnv, logger: Logger): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: API_ENV, useValue: env },
        { provide: APP_LOGGER, useValue: logger },
      ],
      exports: [API_ENV, APP_LOGGER],
    };
  }
}

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv, logger: Logger): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(env, logger),
        InfrastructureModule,
        SecurityModule,
        AuditModule,
        AuthModule,
        HealthModule,
        CatalogModule,
        CustomerModule,
        StoresModule,
        MediaModule,
        ProductsModule,
        AdminModule,
      ],
    };
  }
}
