import { Global, Module } from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../config/api-env';
import { CustomerModule } from '../customer/customer.module';
import { NotificationAccountController } from './account.controller';
import { NotificationStream } from './notification-stream';
import {
  CustomerNotificationsController,
  StoreNotificationsController,
} from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { OneTimeTokens } from './one-time-tokens';
import { PUSH_SENDER, WebPushSender } from './push.sender';
import { HttpTelegramApi, TELEGRAM_API } from './telegram.client';

/** Creating notifications and the channels they go out through; used by the API and the worker. */
@Global()
@Module({
  providers: [
    NotificationsService,
    OneTimeTokens,
    {
      provide: TELEGRAM_API,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) => new HttpTelegramApi(env),
    },
    {
      provide: PUSH_SENDER,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) => new WebPushSender(env),
    },
  ],
  exports: [NotificationsService, OneTimeTokens, TELEGRAM_API, PUSH_SENDER],
})
export class NotificationsCoreModule {}

/** The HTTP side: notification centre, live stream, Telegram and push settings. */
@Module({
  imports: [CustomerModule],
  controllers: [
    CustomerNotificationsController,
    StoreNotificationsController,
    NotificationAccountController,
  ],
  providers: [NotificationStream],
})
export class NotificationsModule {}
