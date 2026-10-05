import { type DynamicModule, Global, Module } from '@nestjs/common';
import { API_ENV, type ApiEnv } from './config/api-env';
import { HealthModule } from './health/health.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';

@Global()
@Module({})
class ConfigModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: API_ENV, useValue: env }],
      exports: [API_ENV],
    };
  }
}

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(env), InfrastructureModule, HealthModule],
    };
  }
}
