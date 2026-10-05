import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLES, roleHasPermission } from '../src/rbac.js';

describe('rbac definitions', () => {
  it('references only declared permissions', () => {
    for (const role of Object.values(ROLES)) {
      for (const permission of role.permissions) {
        expect(Object.keys(PERMISSIONS)).toContain(permission);
      }
    }
  });

  it('keeps admin powers away from sellers and customers', () => {
    for (const role of ['CUSTOMER', 'SELLER', 'SELLER_MANAGER'] as const) {
      expect(roleHasPermission(role, 'admin:access')).toBe(false);
      expect(roleHasPermission(role, 'product:remove')).toBe(false);
      expect(roleHasPermission(role, 'order:read_all')).toBe(false);
    }
  });

  it('lets only the store owner manage integrations and the team', () => {
    expect(roleHasPermission('SELLER', 'integration:manage')).toBe(true);
    expect(roleHasPermission('SELLER_MANAGER', 'integration:manage')).toBe(false);
    expect(roleHasPermission('SELLER_MANAGER', 'store:team_manage')).toBe(false);
  });

  it('reserves role granting and platform settings for the super admin', () => {
    expect(roleHasPermission('ADMIN', 'role:grant')).toBe(false);
    expect(roleHasPermission('ADMIN', 'settings:manage')).toBe(false);
    expect(roleHasPermission('SUPER_ADMIN', 'role:grant')).toBe(true);
  });
});
