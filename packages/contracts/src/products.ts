import { z } from 'zod';

export const PRODUCT_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'HIDDEN',
  'FLAGGED',
  'REMOVED',
  'ARCHIVED',
] as const;
export const productStatusSchema = z.enum(PRODUCT_STATUSES);
export type ProductStatus = z.infer<typeof productStatusSchema>;

export const GENDERS = ['WOMEN', 'MEN', 'UNISEX', 'KIDS'] as const;
export const genderSchema = z.enum(GENDERS);

/** Amounts are integers in tiyn (1 ₸ = 100 tiyn), whole tenge only. */
const price = z
  .number('price.required')
  .int('price.notWholeTenge')
  .positive('price.salePositive')
  .max(100_000_000_00, 'price.tooHigh')
  .refine((value) => value % 100 === 0, { message: 'price.notWholeTenge' });

export const productVariantInputSchema = z.strictObject({
  /** Null for one-size goods (bags, belts). */
  sizeValueId: z.number().int().positive().nullable(),
  quantity: z
    .number()
    .int('quantity.invalid')
    .min(0, 'quantity.invalid')
    .max(9_999, 'quantity.invalid'),
  sku: z.string().trim().min(1).max(60, 'sku.tooLong').optional(),
});

const productFields = {
  title: z.string().trim().min(2, 'title.tooShort').max(120, 'title.tooLong'),
  brand: z.string().trim().min(1, 'brand.required').max(60, 'brand.tooLong'),
  categoryId: z.number().int().positive('category.required'),
  gender: genderSchema,
  colorId: z.number().int().positive('color.required'),
  description: z.string().trim().max(4000, 'description.tooLong').optional(),
  composition: z.string().trim().max(500, 'composition.tooLong').optional(),
  article: z.string().trim().max(60, 'article.tooLong').optional(),
  mediaIds: z.array(z.uuid()).max(10, 'images.tooMany'),
  originalPrice: price,
  salePrice: price,
  variants: z
    .array(productVariantInputSchema)
    .min(1, 'sizes.required')
    .max(40)
    .refine((variants) => new Set(variants.map((v) => v.sizeValueId)).size === variants.length, {
      message: 'sizes.duplicate',
    }),
};

export const createProductRequestSchema = z.strictObject({
  ...productFields,
  /** Publish right away (needs a verified store, a photo, stock and a 30% discount) or save a draft. */
  publish: z.boolean().default(false),
});
export type CreateProductRequest = z.input<typeof createProductRequestSchema>;

export const updateProductRequestSchema = z.strictObject(productFields).partial();
export type UpdateProductRequest = z.input<typeof updateProductRequestSchema>;

export const productActionRequestSchema = z.strictObject({
  action: z.enum(['publish', 'hide', 'archive']),
});

export const mediaSchema = z.object({
  id: z.uuid(),
  /** Folder URL; files are `${url}${width}.${format}` with width 320 | 640 | 1080 and format avif | webp. */
  url: z.string(),
  widths: z.array(z.number().int()),
  width: z.number().int(),
  height: z.number().int(),
});
export type Media = z.infer<typeof mediaSchema>;

export const sellerProductVariantSchema = z.object({
  id: z.uuid(),
  sizeValueId: z.number().int().nullable(),
  sizeLabel: z.string().nullable(),
  sku: z.string(),
  quantity: z.number().int(),
  reserved: z.number().int(),
  available: z.number().int(),
});

export const sellerProductSchema = z.object({
  id: z.uuid(),
  shortId: z.string(),
  slug: z.string(),
  status: productStatusSchema,
  /** Why the system flagged the product, as a code. */
  flagReason: z.string().nullable(),
  /** Why an admin removed the product. */
  removedReason: z.string().nullable(),
  title: z.string(),
  brand: z.string().nullable(),
  categoryId: z.number().int(),
  gender: genderSchema,
  colorId: z.number().int().nullable(),
  description: z.string().nullable(),
  composition: z.string().nullable(),
  article: z.string().nullable(),
  images: z.array(mediaSchema),
  originalPrice: z.number().int(),
  salePrice: z.number().int(),
  /** Lowest public price of the last 30 days, if it limits the discount. */
  referencePrice: z.number().int().nullable(),
  discountPercent: z.number().int(),
  variants: z.array(sellerProductVariantSchema),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type SellerProduct = z.infer<typeof sellerProductSchema>;

export const productListItemSchema = z.object({
  id: z.uuid(),
  shortId: z.string(),
  title: z.string(),
  brand: z.string().nullable(),
  status: productStatusSchema,
  flagReason: z.string().nullable(),
  removedReason: z.string().nullable(),
  image: mediaSchema.nullable(),
  originalPrice: z.number().int(),
  salePrice: z.number().int(),
  discountPercent: z.number().int(),
  available: z.number().int(),
  sizes: z.array(z.object({ label: z.string().nullable(), available: z.number().int() })),
  storeId: z.uuid(),
  storeName: z.string(),
  updatedAt: z.iso.datetime({ offset: true }),
  createdAt: z.iso.datetime({ offset: true }),
});
export type ProductListItem = z.infer<typeof productListItemSchema>;

export const productListSchema = z.object({
  items: z.array(productListItemSchema),
  total: z.number().int(),
});
export type ProductList = z.infer<typeof productListSchema>;

export const sellerProductListQuerySchema = z.object({
  status: productStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const adminProductListQuerySchema = z.object({
  filter: z.enum(['flagged', 'recent', 'removed']).default('flagged'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const sizeChartSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  name: z.object({ ru: z.string(), kk: z.string() }),
  values: z.array(z.object({ id: z.number().int(), code: z.string() })),
});
export const sizeChartListSchema = z.array(sizeChartSchema);
export type SizeChart = z.infer<typeof sizeChartSchema>;

export const colorSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  name: z.object({ ru: z.string(), kk: z.string() }),
  hex: z.string().nullable(),
});
export const colorListSchema = z.array(colorSchema);
export type Color = z.infer<typeof colorSchema>;

export const minDiscountSchema = z.object({ minDiscountPercent: z.number().int() });
