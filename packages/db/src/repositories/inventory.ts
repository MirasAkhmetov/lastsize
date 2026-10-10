import { and, eq, gte, sql } from 'drizzle-orm';
import type { Executor, Transaction } from '../client.js';
import { InventoryConflictError, OutOfStockError, type StockShortage } from '../errors.js';
import { inventory, inventoryTransactions } from '../schema/index.js';

export interface StockLine {
  variantId: string;
  locationId: string;
  quantity: number;
}

/** What caused a stock movement; stored in the ledger. */
export interface MovementRef {
  refType: string;
  refId: string;
  actorUserId?: string | null;
}

type MovementType = (typeof inventoryTransactions.$inferInsert)['type'];

function assertPositiveQuantity(line: StockLine): void {
  if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
    throw new RangeError(`Quantity must be a positive integer, got ${line.quantity}`);
  }
}

/**
 * Merges duplicate lines and sorts them by (variant, location). Locking rows in one global order
 * prevents deadlocks between concurrent orders that share items.
 */
function normalise(lines: readonly StockLine[]): StockLine[] {
  const merged = new Map<string, StockLine>();
  for (const line of lines) {
    assertPositiveQuantity(line);
    const key = `${line.variantId}:${line.locationId}`;
    const existing = merged.get(key);
    merged.set(
      key,
      existing ? { ...existing, quantity: existing.quantity + line.quantity } : { ...line },
    );
  }
  return [...merged.values()].sort(
    (a, b) => a.variantId.localeCompare(b.variantId) || a.locationId.localeCompare(b.locationId),
  );
}

async function recordMovement(
  tx: Transaction,
  line: Pick<StockLine, 'variantId' | 'locationId'>,
  type: MovementType,
  deltas: { quantity: number; reserved: number },
  after: { quantity: number; reserved: number },
  ref: MovementRef,
): Promise<void> {
  await tx.insert(inventoryTransactions).values({
    variantId: line.variantId,
    locationId: line.locationId,
    type,
    quantityDelta: deltas.quantity,
    reservedDelta: deltas.reserved,
    quantityAfter: after.quantity,
    reservedAfter: after.reserved,
    refType: ref.refType,
    refId: ref.refId,
    actorUserId: ref.actorUserId ?? null,
  });
}

const byKey = (line: Pick<StockLine, 'variantId' | 'locationId'>) =>
  and(eq(inventory.variantId, line.variantId), eq(inventory.locationId, line.locationId));

/**
 * Reserves all lines or none. Each line is a single conditional UPDATE: the row lock and the
 * availability check happen atomically, so two buyers can never both get the last item.
 * Runs in its own transaction, or in a savepoint when given an open transaction.
 */
export async function reserveStock(
  executor: Executor,
  lines: readonly StockLine[],
  ref: MovementRef,
): Promise<void> {
  const normalised = normalise(lines);
  await executor.transaction(async (tx) => {
    const shortages: StockShortage[] = [];
    for (const line of normalised) {
      const [row] = await tx
        .update(inventory)
        .set({ reserved: sql`${inventory.reserved} + ${line.quantity}` })
        .where(
          and(byKey(line), sql`${inventory.quantity} - ${inventory.reserved} >= ${line.quantity}`),
        )
        .returning({ quantity: inventory.quantity, reserved: inventory.reserved });
      if (!row) {
        const [current] = await tx
          .select({ available: inventory.available })
          .from(inventory)
          .where(byKey(line));
        shortages.push({
          variantId: line.variantId,
          locationId: line.locationId,
          requested: line.quantity,
          available: current?.available ?? 0,
        });
        continue;
      }
      if (shortages.length === 0) {
        await recordMovement(
          tx,
          line,
          'RESERVE',
          { quantity: 0, reserved: line.quantity },
          row,
          ref,
        );
      }
    }
    // Throwing rolls back every reservation made above.
    if (shortages.length > 0) throw new OutOfStockError(shortages);
  });
}

async function applyReservedChange(
  executor: Executor,
  lines: readonly StockLine[],
  ref: MovementRef,
  type: 'RELEASE' | 'COMMIT',
): Promise<void> {
  const normalised = normalise(lines);
  await executor.transaction(async (tx) => {
    for (const line of normalised) {
      const quantityDelta = type === 'COMMIT' ? -line.quantity : 0;
      const [row] = await tx
        .update(inventory)
        .set({
          quantity: sql`${inventory.quantity} + ${quantityDelta}`,
          reserved: sql`${inventory.reserved} - ${line.quantity}`,
        })
        .where(and(byKey(line), gte(inventory.reserved, line.quantity)))
        .returning({ quantity: inventory.quantity, reserved: inventory.reserved });
      if (!row) {
        throw new InventoryConflictError(
          line.variantId,
          line.locationId,
          `Cannot ${type.toLowerCase()} ${line.quantity}: fewer units are reserved`,
        );
      }
      await recordMovement(
        tx,
        line,
        type,
        { quantity: quantityDelta, reserved: -line.quantity },
        row,
        ref,
      );
    }
  });
}

/** Returns reserved units to sale (order cancelled or expired). */
export function releaseStock(executor: Executor, lines: readonly StockLine[], ref: MovementRef) {
  return applyReservedChange(executor, lines, ref, 'RELEASE');
}

/** Removes reserved units for good (handed to the buyer or the courier). */
export function commitStock(executor: Executor, lines: readonly StockLine[], ref: MovementRef) {
  return applyReservedChange(executor, lines, ref, 'COMMIT');
}

/** Puts returned units back on sale. */
export async function returnStock(
  executor: Executor,
  lines: readonly StockLine[],
  ref: MovementRef,
): Promise<void> {
  const normalised = normalise(lines);
  await executor.transaction(async (tx) => {
    for (const line of normalised) {
      const [row] = await tx
        .update(inventory)
        .set({ quantity: sql`${inventory.quantity} + ${line.quantity}` })
        .where(byKey(line))
        .returning({ quantity: inventory.quantity, reserved: inventory.reserved });
      if (!row) {
        throw new InventoryConflictError(
          line.variantId,
          line.locationId,
          'Inventory row not found',
        );
      }
      await recordMovement(tx, line, 'RETURN', { quantity: line.quantity, reserved: 0 }, row, ref);
    }
  });
}

/**
 * Sets the on-hand count after a manual stock take (ADJUST) or creates the row if missing.
 * Refuses to go below the reserved amount: units promised to buyers cannot disappear.
 */
export async function setStockLevel(
  executor: Executor,
  target: { variantId: string; locationId: string; quantity: number },
  ref: MovementRef,
): Promise<void> {
  if (!Number.isInteger(target.quantity) || target.quantity < 0) {
    throw new RangeError(`Quantity must be a non-negative integer, got ${target.quantity}`);
  }
  await executor.transaction(async (tx) => {
    await tx
      .insert(inventory)
      .values({ variantId: target.variantId, locationId: target.locationId, quantity: 0 })
      .onConflictDoNothing();
    const [before] = await tx
      .select({ quantity: inventory.quantity, reserved: inventory.reserved })
      .from(inventory)
      .where(byKey(target))
      .for('update');
    if (!before)
      throw new InventoryConflictError(
        target.variantId,
        target.locationId,
        'Inventory row not found',
      );
    if (target.quantity < before.reserved) {
      throw new InventoryConflictError(
        target.variantId,
        target.locationId,
        `Cannot set stock to ${target.quantity}: ${before.reserved} unit(s) are reserved by orders`,
      );
    }
    const [after] = await tx
      .update(inventory)
      .set({ quantity: target.quantity, stockConfirmedAt: sql`now()` })
      .where(byKey(target))
      .returning({ quantity: inventory.quantity, reserved: inventory.reserved });
    if (!after)
      throw new InventoryConflictError(
        target.variantId,
        target.locationId,
        'Inventory row not found',
      );
    if (after.quantity !== before.quantity) {
      await recordMovement(
        tx,
        target,
        'ADJUST',
        { quantity: after.quantity - before.quantity, reserved: 0 },
        after,
        ref,
      );
    }
  });
}

export interface SyncDeltaResult {
  before: number;
  after: number;
  /** The marketplace sold more than is free here: stock stopped at the reserved amount. */
  clamped: boolean;
  /** quantity − reserved after the change. */
  available: number;
}

/**
 * Applies a stock change seen on a marketplace (sold there: negative delta). Units reserved by
 * our buyers are never taken away; if the marketplace sold them too, the result is clamped and
 * reported so the seller can sort it out.
 */
export async function applySyncDelta(
  executor: Executor,
  target: { variantId: string; locationId: string; delta: number },
  ref: MovementRef,
): Promise<SyncDeltaResult | null> {
  if (!Number.isInteger(target.delta)) throw new RangeError('Delta must be an integer');
  return executor.transaction(async (tx) => {
    const [before] = await tx
      .select({ quantity: inventory.quantity, reserved: inventory.reserved })
      .from(inventory)
      .where(byKey(target))
      .for('update');
    if (!before) return null;
    const wanted = before.quantity + target.delta;
    const quantity = Math.max(wanted, before.reserved, 0);
    const [after] = await tx
      .update(inventory)
      .set({ quantity, stockConfirmedAt: sql`now()` })
      .where(byKey(target))
      .returning({ quantity: inventory.quantity, reserved: inventory.reserved });
    if (after!.quantity !== before.quantity) {
      await recordMovement(
        tx,
        target,
        'SYNC',
        { quantity: after!.quantity - before.quantity, reserved: 0 },
        after!,
        ref,
      );
    }
    return {
      before: before.quantity,
      after: after!.quantity,
      clamped: quantity !== wanted,
      available: after!.quantity - after!.reserved,
    };
  });
}
