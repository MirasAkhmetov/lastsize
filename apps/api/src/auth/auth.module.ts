import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module';
import { SecurityModule } from '../security/security.module';
import { AccessGuard } from './access.guard';
import { AccessService } from './access.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';

@Module({
  imports: [SecurityModule, AuditModule],
  controllers: [AuthController],
  providers: [
    AccessService,
    AuthService,
    PasswordService,
    SessionService,
    TotpService,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [AccessService, PasswordService, SessionService],
})
export class AuthModule {}
