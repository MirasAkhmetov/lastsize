export interface StoreAccess {
  storeId: string;
  storeName: string;
  storeSlug: string;
  role: 'SELLER' | 'SELLER_MANAGER';
  permissions: ReadonlySet<string>;
}

export interface AuthContext {
  user: {
    id: string;
    name: string;
    phone: string;
    phoneVerified: boolean;
  };
  sessionId: string;
  roles: readonly string[];
  /** Global permissions from user roles. */
  permissions: ReadonlySet<string>;
  /** Store-scoped permissions, keyed by store id. */
  stores: ReadonlyMap<string, StoreAccess>;
  mfaEnrolled: boolean;
  mfaVerified: boolean;
}

export interface CustomerContext {
  id: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
    customer?: CustomerContext;
  }
}
