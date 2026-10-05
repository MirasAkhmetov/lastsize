import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AccessService } from './access.service';
import {
  IS_PUBLIC,
  REQUIRED_PERMISSIONS,
  STORE_ACCESS,
  type StoreAccessRequirement,
} from './decorators';
import { SessionService } from './session.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Global guard, deny by default. Every route needs a signed-in, active user unless it is
 * marked @Public(). Permissions are always checked here on the server, whatever the UI shows.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) ?? false;

    const session = await this.sessions.resolve(request);
    if (session) {
      const loaded = await this.access.load(session);
      if (loaded?.status === 'ACTIVE') {
        request.auth = loaded.context;
        await this.sessions.touch(session, loaded.sessionKind);
      } else {
        // Blocked or deleted users lose every session immediately.
        await this.sessions.revoke(session.id);
      }
    }

    if (isPublic) return true;
    const auth = request.auth;
    if (!auth) throw new UnauthorizedException('Войдите в аккаунт');

    const permissions =
      this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, targets) ?? [];
    for (const permission of permissions) {
      if (!auth.permissions.has(permission)) throw new ForbiddenException('Недостаточно прав');
    }
    if (permissions.includes('admin:access') && !auth.mfaVerified) {
      throw new ForbiddenException('Подтвердите вход кодом из приложения-аутентификатора');
    }

    const storeRequirement = this.reflector.getAllAndOverride<StoreAccessRequirement>(
      STORE_ACCESS,
      targets,
    );
    if (storeRequirement) {
      const params = request.params as Record<string, string | undefined>;
      const storeId = params[storeRequirement.param];
      // Same answer for "does not exist" and "not yours": store ids cannot be probed.
      const store = storeId && UUID.test(storeId) ? auth.stores.get(storeId) : undefined;
      if (!store) throw new NotFoundException('Магазин не найден');
      if (storeRequirement.permission && !store.permissions.has(storeRequirement.permission)) {
        throw new ForbiddenException('Недостаточно прав в этом магазине');
      }
    }
    return true;
  }
}
