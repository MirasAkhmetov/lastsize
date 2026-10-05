import { Global, Module } from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../config/api-env';
import { RateLimiterService } from './rate-limiter.service';
import { SecretBox } from './secret-box';

export const SECRET_BOX = Symbol('SECRET_BOX');

@Global()
@Module({
  providers: [
    RateLimiterService,
    {
      provide: SECRET_BOX,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) => new SecretBox(env.SECRETS_ENCRYPTION_KEY),
    },
  ],
  exports: [RateLimiterService, SECRET_BOX],
})
export class SecurityModule {}
