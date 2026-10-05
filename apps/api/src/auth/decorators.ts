import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@lastsize/db';
import type { FastifyRequest } from 'fastify';
import type { AuthContext } from './auth.types';

export const IS_PUBLIC = 'auth:isPublic';
export const REQUIRED_PERMISSIONS = 'auth:requiredPermissions';
export const STORE_ACCESS = 'auth:storeAccess';

/** Opens a route to anonymous visitors. Everything else requires a signed-in user. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Requires global permissions. Routes that require `admin:access` additionally require a
 * session that passed the TOTP check.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

export interface StoreAccessRequirement {
  /** Route parameter holding the store id. */
  param: string;
  /** Store permission required; omit to require membership only. */
  permission?: Permission;
}

/** Requires membership in the store from the route (non-members get 404, not 403). */
export const RequireStoreAccess = (permission?: Permission, param = 'storeId') =>
  SetMetadata(STORE_ACCESS, { param, permission } satisfies StoreAccessRequirement);

/** The signed-in user; only valid on routes that are not @Public(). */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const auth = context.switchToHttp().getRequest<FastifyRequest>().auth;
    if (!auth) throw new Error('CurrentAuth used on a route without authentication');
    return auth;
  },
);
