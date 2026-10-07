import { z } from 'zod';

export const adminUserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  phone: z.string(),
  status: z.enum(['ACTIVE', 'BLOCKED']),
  roles: z.array(z.string()),
  createdAt: z.iso.datetime({ offset: true }),
});

export const adminUserListSchema = z.object({
  items: z.array(adminUserSchema),
  total: z.number().int(),
});
export type AdminUserList = z.infer<typeof adminUserListSchema>;

export const sellerStoreSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(['PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'BLOCKED']),
  role: z.enum(['SELLER', 'SELLER_MANAGER']),
  /** Why the store was rejected or blocked; null otherwise. */
  statusReason: z.string().nullable(),
});
export type SellerStore = z.infer<typeof sellerStoreSchema>;
