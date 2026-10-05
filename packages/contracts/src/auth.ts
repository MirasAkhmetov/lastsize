import { z } from 'zod';
import { kzPhoneSchema } from './phone.js';

/** Long enough to resist guessing; capped so hashing cannot be used for denial of service. */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters');

export const registerRequestSchema = z.strictObject({
  phone: kzPhoneSchema,
  name: z.string().trim().min(2).max(100),
  password: passwordSchema,
});
export type RegisterRequest = z.input<typeof registerRequestSchema>;

export const loginRequestSchema = z.strictObject({
  phone: kzPhoneSchema,
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.input<typeof loginRequestSchema>;

export const totpCodeRequestSchema = z.strictObject({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from the authenticator app'),
});
export type TotpCodeRequest = z.infer<typeof totpCodeRequestSchema>;

export const storeMembershipSchema = z.object({
  storeId: z.uuid(),
  storeName: z.string(),
  storeSlug: z.string(),
  role: z.enum(['SELLER', 'SELLER_MANAGER']),
  permissions: z.array(z.string()),
});

export const meResponseSchema = z.object({
  user: z.object({
    id: z.uuid(),
    name: z.string(),
    phone: z.string(),
    phoneVerified: z.boolean(),
  }),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  stores: z.array(storeMembershipSchema),
  mfa: z.object({
    /** The account must pass TOTP before admin actions. */
    required: z.boolean(),
    enrolled: z.boolean(),
    verified: z.boolean(),
  }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const mfaSetupResponseSchema = z.object({
  /** otpauth:// URI for the QR code. Shown once; the secret is stored encrypted. */
  otpauthUri: z.string(),
  secret: z.string(),
});
export type MfaSetupResponse = z.infer<typeof mfaSetupResponseSchema>;

export const customerProfileSchema = z.object({
  name: z.string().nullable(),
  phone: z.string().nullable(),
  locale: z.enum(['ru', 'kk']),
});
export type CustomerProfile = z.infer<typeof customerProfileSchema>;

export const updateCustomerProfileRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(100).optional(),
  phone: kzPhoneSchema.optional(),
  locale: z.enum(['ru', 'kk']).optional(),
});
