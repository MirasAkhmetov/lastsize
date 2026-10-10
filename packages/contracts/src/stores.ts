import { z } from 'zod';
import { isValidBinIin } from './bin-iin.js';
import { kzPhoneSchema } from './phone.js';

export const STORE_STATUSES = ['PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'BLOCKED'] as const;
export const storeStatusSchema = z.enum(STORE_STATUSES);
export type StoreStatus = z.infer<typeof storeStatusSchema>;

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'schedule.time');
const interval = z
  .tuple([time, time])
  .refine(([open, close]) => open < close, { message: 'schedule.order' });

/** Opening hours per weekday; an empty list means closed that day. */
export const scheduleSchema = z
  .object(
    Object.fromEntries(WEEKDAYS.map((day) => [day, z.array(interval).max(3)])) as Record<
      Weekday,
      z.ZodArray<typeof interval>
    >,
  )
  .refine((schedule) => WEEKDAYS.some((day) => schedule[day].length > 0), {
    message: 'schedule.empty',
  });
export type Schedule = z.infer<typeof scheduleSchema>;

export const binIinSchema = z
  .string()
  .transform((value) => value.replace(/\s/g, ''))
  .refine(isValidBinIin, { message: 'binIin.invalid' });

const instagramSchema = z
  .string()
  .trim()
  .transform((value) =>
    value
      .replace(/^@/, '')
      .replace(/^https?:\/\/(www\.)?instagram\.com\//, '')
      .replace(/\/$/, ''),
  )
  .pipe(z.string().regex(/^[A-Za-z0-9._]{1,30}$/, 'instagram.invalid'));

const storeLocationFields = {
  cityId: z.number().int().positive('city.required'),
  address: z.string().trim().min(5, 'address.tooShort').max(200, 'address.tooLong'),
  phone: kzPhoneSchema,
  schedule: scheduleSchema,
  pickupEnabled: z.boolean(),
  /** The store sends orders by courier (it calls Yandex Go / inDrive; the buyer pays). */
  deliveryEnabled: z.boolean(),
};

export const storeLocationInputSchema = z.strictObject({
  ...storeLocationFields,
  pickupEnabled: storeLocationFields.pickupEnabled.default(true),
  deliveryEnabled: storeLocationFields.deliveryEnabled.default(true),
});

export const createStoreRequestSchema = z.strictObject({
  name: z.string().trim().min(2, 'storeName.tooShort').max(80, 'storeName.tooLong'),
  legalName: z.string().trim().max(200, 'legalName.tooLong').optional(),
  binIin: binIinSchema,
  description: z.string().trim().max(2000, 'description.tooLong').optional(),
  instagram: instagramSchema.optional(),
  location: storeLocationInputSchema,
});
export type CreateStoreRequest = z.input<typeof createStoreRequestSchema>;

/** All fields optional; omitted fields stay unchanged. */
export const updateStoreRequestSchema = createStoreRequestSchema
  .omit({ location: true })
  .partial()
  // No defaults here: a field left out of an update keeps its current value.
  .extend({ location: z.strictObject(storeLocationFields).partial().optional() })
  .strict();
export type UpdateStoreRequest = z.input<typeof updateStoreRequestSchema>;

export const storeLocationSchema = z.object({
  cityId: z.number().int(),
  cityName: z.object({ ru: z.string(), kk: z.string() }),
  address: z.string(),
  phone: z.string(),
  schedule: z.record(z.string(), z.array(z.tuple([z.string(), z.string()]))),
  pickupEnabled: z.boolean(),
  deliveryEnabled: z.boolean(),
});

export const storeDetailSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  legalName: z.string().nullable(),
  binIin: z.string(),
  description: z.string().nullable(),
  instagram: z.string().nullable(),
  status: storeStatusSchema,
  /** Shown to the seller when the store was rejected or blocked. */
  statusReason: z.string().nullable(),
  role: z.enum(['SELLER', 'SELLER_MANAGER']),
  location: storeLocationSchema,
  createdAt: z.iso.datetime({ offset: true }),
});
export type StoreDetail = z.infer<typeof storeDetailSchema>;

export const citySchema = z.object({
  id: z.number().int(),
  slug: z.string(),
  name: z.object({ ru: z.string(), kk: z.string() }),
});
export const cityListSchema = z.array(citySchema);
export type City = z.infer<typeof citySchema>;

export const adminStoreListItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  status: storeStatusSchema,
  city: z.string(),
  ownerName: z.string(),
  ownerPhone: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
});
export const adminStoreListSchema = z.object({
  items: z.array(adminStoreListItemSchema),
  total: z.number().int(),
  counts: z.record(storeStatusSchema, z.number().int()),
});
export type AdminStoreList = z.infer<typeof adminStoreListSchema>;

export const adminStoreListQuerySchema = z.object({
  status: storeStatusSchema.default('PENDING_VERIFICATION'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const storeHistoryEntrySchema = z.object({
  action: z.string(),
  actorName: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});

export const adminStoreDetailSchema = storeDetailSchema.omit({ role: true }).extend({
  owner: z.object({
    id: z.uuid(),
    name: z.string(),
    phone: z.string(),
    phoneVerified: z.boolean(),
  }),
  verifiedAt: z.iso.datetime({ offset: true }).nullable(),
  history: z.array(storeHistoryEntrySchema),
});
export type AdminStoreDetail = z.infer<typeof adminStoreDetailSchema>;

const reasonSchema = z.string().trim().min(5, 'reason.tooShort').max(500, 'reason.tooLong');

export const verifyStoreRequestSchema = z.strictObject({
  /** The admin confirms they called the owner on the registered number. */
  phoneConfirmed: z.literal(true, 'verify.phoneNotConfirmed'),
});
export const storeReasonRequestSchema = z.strictObject({ reason: reasonSchema });
