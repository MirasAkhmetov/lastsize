import { Module } from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../config/api-env';
import { IntegrationsService } from './integrations.service';
import { HttpWildberriesApi, WILDBERRIES_API } from './wildberries.client';

/** Marketplace connections and the WB client; shared by imports, sync and the worker. */
@Module({
  providers: [
    IntegrationsService,
    {
      provide: WILDBERRIES_API,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) => new HttpWildberriesApi(env),
    },
  ],
  exports: [IntegrationsService, WILDBERRIES_API],
})
export class IntegrationsModule {}
