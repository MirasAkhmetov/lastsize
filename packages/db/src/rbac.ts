/**
 * Role-based access control: the single source of truth for roles and their permissions.
 * The seed synchronises these into the roles / permissions tables on every deploy.
 * Store roles (SELLER, SELLER_MANAGER) apply only inside the store a user is a member of.
 */
export const PERMISSIONS = {
  'cart:write': 'Manage own cart and favourites',
  'order:create': 'Place orders',
  'order:read_own': 'Read own orders',

  'product:read_store': 'Read products of own store, including drafts',
  'product:write': 'Create and edit products of own store',
  'price:write': 'Change prices of own store',
  'inventory:write': 'Change stock of own store',
  'order:read_store': 'Read orders of own store',
  'order:transition': 'Confirm, prepare, hand over and cancel orders of own store',
  'return:process': 'Accept or reject returns of own store',
  'store:manage': 'Edit store profile, address and schedule',
  'store:team_manage': 'Invite and remove store managers',
  'integration:manage': 'Connect Wildberries / Kaspi and run imports',

  'admin:access': 'Open the admin panel',
  'seller:verify': 'Verify or reject stores',
  'seller:block': 'Block and unblock stores',
  'product:remove': 'Hide or remove any product',
  'user:read': 'Read users',
  'user:manage': 'Block users and change their data',
  'role:grant': 'Grant and revoke global roles',
  'category:manage': 'Manage categories, brands and size charts',
  'order:read_all': 'Read orders of all stores',
  'settings:manage': 'Change platform settings',
  'audit:read': 'Read the audit log',

  'inventory:sync': 'Apply stock and price changes from marketplace sync',
  'notification:send': 'Send notifications',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ROLES = {
  CUSTOMER: {
    description: 'Guest buyer',
    permissions: ['cart:write', 'order:create', 'order:read_own'],
  },
  SELLER: {
    description: 'Store owner',
    permissions: [
      'product:read_store',
      'product:write',
      'price:write',
      'inventory:write',
      'order:read_store',
      'order:transition',
      'return:process',
      'store:manage',
      'store:team_manage',
      'integration:manage',
    ],
  },
  SELLER_MANAGER: {
    description: 'Store employee',
    permissions: [
      'product:read_store',
      'product:write',
      'price:write',
      'inventory:write',
      'order:read_store',
      'order:transition',
      'return:process',
    ],
  },
  ADMIN: {
    description: 'Platform moderator and operator',
    permissions: [
      'admin:access',
      'seller:verify',
      'seller:block',
      'product:remove',
      'user:read',
      'category:manage',
      'order:read_all',
      'audit:read',
    ],
  },
  SUPER_ADMIN: {
    description: 'Platform owner',
    permissions: [
      'admin:access',
      'seller:verify',
      'seller:block',
      'product:remove',
      'user:read',
      'user:manage',
      'role:grant',
      'category:manage',
      'order:read_all',
      'settings:manage',
      'audit:read',
    ],
  },
  BACKEND_SERVICE: {
    description: 'Internal worker processes',
    permissions: ['inventory:sync', 'notification:send', 'order:read_all'],
  },
} as const satisfies Record<string, { description: string; permissions: readonly Permission[] }>;

export type RoleCode = keyof typeof ROLES;

export function roleHasPermission(role: RoleCode, permission: Permission): boolean {
  return (ROLES[role].permissions as readonly Permission[]).includes(permission);
}
