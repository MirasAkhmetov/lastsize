import { type DynamicModule, Module } from '@nestjs/common';
import type { Logger } from '@lastsize/logger';
import { CoreModule } from './app.module';
import { AuditModule } from './audit/audit.module';
import type { ApiEnv } from './config/api-env';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { SecurityModule } from './security/security.module';
import { SyncQueueModule } from './sync/sync-queue';
import { SyncModule } from './sync/sync.module';
import { SyncWorker } from './sync/sync.worker';

/** Background jobs only: no HTTP, no controllers in use. */
@Module({})
export class WorkerModule {
  static forRoot(env: ApiEnv, logger: Logger): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        CoreModule.forRoot(env, logger),
        InfrastructureModule,
        SecurityModule,
        AuditModule,
        SyncQueueModule,
        SyncModule,
      ],
      providers: [SyncWorker],
    };
  }
}
