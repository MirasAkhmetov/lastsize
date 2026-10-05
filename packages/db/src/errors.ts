export interface StockShortage {
  variantId: string;
  locationId: string;
  requested: number;
  available: number;
}

/** Thrown when at least one line cannot be reserved. Nothing is reserved in that case. */
export class OutOfStockError extends Error {
  constructor(readonly shortages: readonly StockShortage[]) {
    super(`Not enough stock for ${shortages.length} item(s)`);
    this.name = 'OutOfStockError';
  }
}

/** Thrown when a stock operation would break an invariant (e.g. release more than reserved). */
export class InventoryConflictError extends Error {
  constructor(
    readonly variantId: string,
    readonly locationId: string,
    message: string,
  ) {
    super(message);
    this.name = 'InventoryConflictError';
  }
}
