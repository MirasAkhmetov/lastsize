import { Inject, Injectable } from '@nestjs/common';
import {
  type Database,
  rolePermissions,
  storeMembers,
  stores,
  userRoles,
  users,
} from '@lastsize/db';
import { eq, sql } from '@lastsize/db';
import { DATABASE } from '../infrastructure/infrastructure.module';
import type { AuthContext, StoreAccess } from './auth.types';
import type { ActiveSession, SessionKind } from './session.service';

export interface LoadedAccess {
  context: AuthContext;
  status: 'ACTIVE' | 'BLOCKED';
  sessionKind: SessionKind;
}

/** Loads a user's roles and permissions (global and per store) from the database. */
@Injectable()
export class AccessService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async load(
    session: Pick<ActiveSession, 'id' | 'userId' | 'mfaVerified'>,
  ): Promise<LoadedAccess | null> {
    const [user] = await this.db
      .select({
        id: users.id,
        name: users.name,
        phone: users.phone,
        status: users.status,
        phoneVerifiedAt: users.phoneVerifiedAt,
        totpSecretEncrypted: users.totpSecretEncrypted,
      })
      .from(users)
      .where(eq(users.id, session.userId));
    if (!user) return null;

    const [globalRows, storeRows] = await Promise.all([
      this.db
        .select({ role: userRoles.roleCode, permission: rolePermissions.permissionCode })
        .from(userRoles)
        .leftJoin(rolePermissions, eq(rolePermissions.roleCode, userRoles.roleCode))
        .where(eq(userRoles.userId, user.id)),
      this.db
        .select({
          storeId: stores.id,
          storeName: stores.name,
          storeSlug: stores.slug,
          storeStatus: stores.status,
          role: storeMembers.role,
          permission: rolePermissions.permissionCode,
        })
        .from(storeMembers)
        .innerJoin(stores, eq(stores.id, storeMembers.storeId))
        // store_members.role is an enum, role_permissions.role_code is text.
        .leftJoin(rolePermissions, eq(rolePermissions.roleCode, sql`${storeMembers.role}::text`))
        .where(eq(storeMembers.userId, user.id)),
    ]);

    const roles = [...new Set(globalRows.map((row) => row.role))];
    const permissions = new Set(
      globalRows.flatMap((row) => (row.permission ? [row.permission] : [])),
    );

    const storeAccess = new Map<string, StoreAccess & { permissions: Set<string> }>();
    for (const row of storeRows) {
      // A blocked store keeps no seller powers.
      if (row.storeStatus === 'BLOCKED') continue;
      const entry = storeAccess.get(row.storeId) ?? {
        storeId: row.storeId,
        storeName: row.storeName,
        storeSlug: row.storeSlug,
        role: row.role,
        permissions: new Set<string>(),
      };
      if (row.permission) entry.permissions.add(row.permission);
      storeAccess.set(row.storeId, entry);
    }

    const staff = permissions.has('admin:access');
    return {
      status: user.status,
      sessionKind: staff ? 'staff' : 'regular',
      context: {
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          phoneVerified: user.phoneVerifiedAt !== null,
        },
        sessionId: session.id,
        roles,
        permissions,
        stores: storeAccess,
        mfaEnrolled: user.totpSecretEncrypted !== null,
        mfaVerified: session.mfaVerified,
      },
    };
  }
}
