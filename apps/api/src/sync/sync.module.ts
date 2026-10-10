import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../imports/integrations.module';
import { StockSyncService } from './stock-sync.service';
import { SyncController } from './sync.controller';

@Module({
  imports: [IntegrationsModule],
  controllers: [SyncController],
  providers: [StockSyncService],
  exports: [StockSyncService],
})
export class SyncModule {}
