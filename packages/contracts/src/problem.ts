import { z } from 'zod';

/** Machine-readable error codes returned in `ProblemDetails.code`. */
export const errorCodes = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  /** Checkout: some sizes ran out; `errors` lists them (path = variant id). */
  'OUT_OF_STOCK',
  /** Checkout: prices in the cart changed; the cart now shows the new ones. */
  'PRICE_CHANGED',
  /** Checkout: the cart changed (goods removed from sale, stores differ from the request). */
  'CART_CHANGED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;
export const errorCodeSchema = z.enum(errorCodes);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** RFC 9457 problem details, the single error format of the API. */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: errorCodeSchema,
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
