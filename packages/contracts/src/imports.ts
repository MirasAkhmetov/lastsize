import { z } from 'zod';
import { genderSchema, mediaSchema } from './products.js';

export const INTEGRATION_PROVIDERS = ['WILDBERRIES', 'KASPI_XML'] as const;
export const integrationProviderSchema = z.enum(INTEGRATION_PROVIDERS);
export const IMPORT_SOURCES = ['WILDBERRIES', 'KASPI_XML', 'FILE'] as const;
export const importSourceSchema = z.enum(IMPORT_SOURCES);
export const IMPORT_ROW_STATUSES = [
  'READY',
  'NEEDS_ATTENTION',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'SKIPPED',
] as const;
export const importRowStatusSchema = z.enum(IMPORT_ROW_STATUSES);
export type ImportRowStatus = z.infer<typeof importRowStatusSchema>;
export const SIZE_CHART_CODES = ['CLOTHING_INT', 'SHOES_EU', 'KIDS_HEIGHT'] as const;

/** A connected marketplace. The token itself is never sent back, only its last characters. */
export const integrationSchema = z.object({
  provider: integrationProviderSchema,
  status: z.enum(['ACTIVE', 'ERROR']),
  tokenHint: z.string().nullable(),
  kaspiUrl: z.string().nullable(),
  lastSuccessAt: z.iso.datetime({ offset: true }).nullable(),
  lastError: z.string().nullable(),
  connectedAt: z.iso.datetime({ offset: true }),
  /** Stock sync settings. */
  syncEnabled: z.boolean(),
  pushStock: z.boolean(),
  warehouseId: z.number().int().nullable(),
  lastSyncAt: z.iso.datetime({ offset: true }).nullable(),
  syncing: z.boolean(),
  /** Our variants linked to this marketplace (imported from it). */
  linkedCount: z.number().int(),
});
export const integrationListSchema = z.array(integrationSchema);
export type Integration = z.infer<typeof integrationSchema>;

export const connectWildberriesRequestSchema = z.strictObject({
  token: z
    .string()
    .trim()
    .min(20, 'wb.tokenInvalid')
    .max(2000, 'wb.tokenInvalid')
    .regex(/^[A-Za-z0-9._-]+$/, 'wb.tokenInvalid'),
});

const kaspiUrl = z.url({ protocol: /^https?$/, error: 'url.invalid' }).max(2000, 'url.invalid');

export const createImportRequestSchema = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('WILDBERRIES') }),
  z.strictObject({ source: z.literal('KASPI_XML'), url: kaspiUrl }),
]);
export type CreateImportRequest = z.input<typeof createImportRequestSchema>;

const counts = z.object({
  total: z.number().int(),
  ready: z.number().int(),
  needsAttention: z.number().int(),
  publishing: z.number().int(),
  published: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  /** Ready and selected: what "Publish" will process. */
  toPublish: z.number().int(),
});

const unmappedValue = z.object({ value: z.string(), count: z.number().int() });

export const importJobSchema = z.object({
  id: z.uuid(),
  source: importSourceSchema,
  createdAt: z.iso.datetime({ offset: true }),
  /** Codes, e.g. "wb.pricesNotInTenge". */
  warnings: z.array(z.string()),
  counts,
  /** Source values that are not matched yet, most frequent first. */
  unmapped: z.object({
    categories: z.array(unmappedValue),
    colors: z.array(unmappedValue),
    sizes: z.array(unmappedValue.extend({ chart: z.enum(SIZE_CHART_CODES) })),
    /** Open rows without gender. */
    missingGender: z.number().int(),
  }),
});
export type ImportJob = z.infer<typeof importJobSchema>;

export const importJobListSchema = z.array(
  z.object({
    id: z.uuid(),
    source: importSourceSchema,
    createdAt: z.iso.datetime({ offset: true }),
    counts,
  }),
);
export type ImportJobList = z.infer<typeof importJobListSchema>;

export const importRowSchema = z.object({
  id: z.uuid(),
  position: z.number().int(),
  externalId: z.string(),
  title: z.string(),
  brand: z.string().nullable(),
  article: z.string().nullable(),
  sourceCategory: z.string().nullable(),
  sourceColor: z.string().nullable(),
  /** Photos found in the source (downloaded when the row is published). */
  photoCount: z.number().int(),
  /** Photos the seller uploaded for this row (Kaspi lists have none). */
  images: z.array(mediaSchema),
  sizes: z.array(
    z.object({
      label: z.string().nullable(),
      quantity: z.number().int(),
      sizeValueId: z.number().int().nullable(),
    }),
  ),
  chart: z.enum(SIZE_CHART_CODES).nullable(),
  categoryId: z.number().int().nullable(),
  gender: genderSchema.nullable(),
  colorId: z.number().int().nullable(),
  selected: z.boolean(),
  originalPrice: z.number().int().nullable(),
  salePrice: z.number().int().nullable(),
  externalPrice: z.number().int().nullable(),
  discountPercent: z.number().int().nullable(),
  status: importRowStatusSchema,
  issues: z.array(z.string()),
  productId: z.uuid().nullable(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export const importRowPageSchema = z.object({
  items: z.array(importRowSchema),
  total: z.number().int(),
});
export type ImportRowPage = z.infer<typeof importRowPageSchema>;

export const IMPORT_ROW_FILTERS = ['all', 'attention', 'ready', 'published', 'failed'] as const;
export const importRowQuerySchema = z.object({
  filter: z.enum(IMPORT_ROW_FILTERS).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

const tiyn = z
  .number()
  .int('price.notWholeTenge')
  .positive('price.salePositive')
  .max(100_000_000_00, 'price.tooHigh')
  .refine((value) => value % 100 === 0, { message: 'price.notWholeTenge' });

export const updateImportRowRequestSchema = z
  .strictObject({
    title: z.string().trim().min(2, 'title.tooShort').max(120, 'title.tooLong'),
    brand: z.string().trim().min(1, 'brand.required').max(60, 'brand.tooLong'),
    categoryId: z.number().int().positive(),
    gender: genderSchema,
    colorId: z.number().int().positive(),
    selected: z.boolean(),
    originalPrice: tiyn,
    salePrice: tiyn,
    /** Same sizes as the row, in the same order; only the match and the quantity change. */
    sizes: z
      .array(
        z.strictObject({
          sizeValueId: z.number().int().positive().nullable(),
          quantity: z.number().int().min(0, 'quantity.invalid').max(9_999, 'quantity.invalid'),
        }),
      )
      .max(60),
    mediaIds: z.array(z.uuid()).max(10, 'images.tooMany'),
  })
  .partial();
export type UpdateImportRowRequest = z.input<typeof updateImportRowRequestSchema>;

/** "WB «Кроссовки» is our sneakers": remembered for the store and applied to the whole job. */
export const importMappingRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('CATEGORY'),
    sourceValue: z.string().min(1).max(100),
    targetId: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal('COLOR'),
    sourceValue: z.string().min(1).max(100),
    targetId: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal('SIZE'),
    chart: z.enum(SIZE_CHART_CODES),
    sourceValue: z.string().min(1).max(20),
    targetId: z.number().int().positive(),
  }),
]);
export type ImportMappingRequest = z.input<typeof importMappingRequestSchema>;

export const importPriceRequestSchema = z.strictObject({
  /** Sale price = marketplace price (or "price before discount") minus this percent. */
  percent: z.number().int().min(1).max(95),
});

export const importSelectionRequestSchema = z.strictObject({ selected: z.boolean() });

export const importPublishRequestSchema = z.strictObject({
  /** Drafts while the store is not verified yet. */
  mode: z.enum(['publish', 'draft']),
});

export const importPublishResultSchema = z.object({
  processed: z.array(
    z.object({
      rowId: z.uuid(),
      status: importRowStatusSchema,
      productId: z.uuid().nullable(),
      issues: z.array(z.string()),
    }),
  ),
  remaining: z.number().int(),
});
export type ImportPublishResult = z.infer<typeof importPublishResultSchema>;

export const updateIntegrationRequestSchema = z
  .strictObject({
    syncEnabled: z.boolean(),
    /** WB only: write our stock back to WB; needs a chosen warehouse. */
    pushStock: z.boolean(),
    /** WB only: the FBS warehouse to sync; null = sum of all, read-only. */
    warehouseId: z.number().int().positive().nullable(),
  })
  .partial();
export type UpdateIntegrationRequest = z.input<typeof updateIntegrationRequestSchema>;

export const warehouseListSchema = z.array(z.object({ id: z.number().int(), name: z.string() }));
export type Warehouse = z.infer<typeof warehouseListSchema>[number];

export const syncRunSchema = z.object({
  id: z.uuid(),
  trigger: z.enum(['SCHEDULE', 'MANUAL', 'STOCK_CHANGE']),
  status: z.enum(['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED']),
  pulled: z.number().int(),
  pushed: z.number().int(),
  conflicts: z.number().int(),
  /** Error code, e.g. "wb.pushForbidden". */
  error: z.string().nullable(),
  changes: z.array(
    z.object({
      kind: z.enum(['pull', 'push', 'conflict', 'price']),
      title: z.string(),
      size: z.string().nullable(),
      from: z.number().int().nullable(),
      to: z.number().int().nullable(),
    }),
  ),
  startedAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
});
export const syncRunListSchema = z.array(syncRunSchema);
export type SyncRun = z.infer<typeof syncRunSchema>;
