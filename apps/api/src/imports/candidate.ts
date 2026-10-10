import type { ImportRowData } from '@lastsize/db';

/** One product found in a source, before it is matched to our catalogue. */
export interface ImportCandidate {
  externalId: string;
  data: ImportRowData;
  /** Amounts in tiyn. */
  originalPrice: number | null;
  salePrice: number | null;
  /** Actual selling price on the marketplace, if known in tenge. */
  externalPrice: number | null;
}

/** Problems with the source as a whole, shown above the rows. */
export class SourceRejectedError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SourceRejectedError';
  }
}

export const MAX_IMPORT_ROWS = 2000;
export const MAX_PHOTOS = 10;

export function clip(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}
