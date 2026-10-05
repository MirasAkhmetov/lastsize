import { inArray, notInArray, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { PERMISSIONS, ROLES } from './rbac.js';
import {
  CATEGORIES,
  CITIES,
  COLORS,
  SETTINGS,
  SIZE_CHARTS,
  SIZE_VALUES,
} from './reference-data.js';
import {
  categories,
  cities,
  colors,
  permissions,
  platformSettings,
  rolePermissions,
  roles,
  sizeCharts,
  sizeValues,
} from './schema/index.js';

/**
 * Brings reference data up to date. Roles and permissions are fully synchronised with rbac.ts
 * (they are code). Everything else is only inserted when missing, so admin edits survive.
 */
export async function seedReferenceData(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    const permissionRows = Object.entries(PERMISSIONS).map(([code, description]) => ({
      code,
      description,
    }));
    await tx
      .insert(permissions)
      .values(permissionRows)
      .onConflictDoUpdate({
        target: permissions.code,
        set: { description: sql`excluded.description` },
      });

    const roleRows = Object.entries(ROLES).map(([code, role]) => ({
      code,
      description: role.description,
    }));
    await tx
      .insert(roles)
      .values(roleRows)
      .onConflictDoUpdate({ target: roles.code, set: { description: sql`excluded.description` } });

    const roleCodes = roleRows.map((role) => role.code);
    await tx.delete(rolePermissions).where(inArray(rolePermissions.roleCode, roleCodes));
    await tx
      .insert(rolePermissions)
      .values(
        Object.entries(ROLES).flatMap(([roleCode, role]) =>
          role.permissions.map((permissionCode) => ({ roleCode, permissionCode })),
        ),
      );
    // Permissions removed from the code disappear from the database as well.
    await tx.delete(permissions).where(
      notInArray(
        permissions.code,
        permissionRows.map((permission) => permission.code),
      ),
    );

    await tx.insert(cities).values(CITIES).onConflictDoNothing();
    await tx.insert(sizeCharts).values(SIZE_CHARTS).onConflictDoNothing();
    await tx.insert(sizeValues).values(SIZE_VALUES).onConflictDoNothing();
    await tx.insert(colors).values(COLORS).onConflictDoNothing();
    // Parents come first in CATEGORIES, so foreign keys are satisfied in a single insert.
    await tx.insert(categories).values(CATEGORIES).onConflictDoNothing();
    await tx
      .insert(platformSettings)
      .values(Object.entries(SETTINGS).map(([key, value]) => ({ key, value })))
      .onConflictDoNothing();
  });
}
