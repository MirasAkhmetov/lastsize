import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InventoryConflictError, OutOfStockError } from '../src/errors.js';
import {
  applySyncDelta,
  commitStock,
  releaseStock,
  reserveStock,
  returnStock,
  setStockLevel,
} from '../src/repositories/inventory.js';
import { inventory, inventoryTransactions } from '../src/schema/index.js';
import { createVariantWithStock } from './fixtures.js';
import { dbError, describePgError } from './db-error.js';
import { createTestDatabase, type TestDatabase, testDatabaseUrl } from '../src/testing.js';

const order = () => ({ refType: 'seller_order', refId: randomUUID() });

describe.runIf(testDatabaseUrl)('inventory', () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => {
    await t?.drop();
  });

  async function stockOf(variantId: string, locationId: string) {
    const [row] = await t.db
      .select()
      .from(inventory)
      .where(and(eq(inventory.variantId, variantId), eq(inventory.locationId, locationId)));
    return row!;
  }

  it('sells the last item to exactly one of 50 concurrent buyers', async () => {
    const { variant, location } = await createVariantWithStock(t.db, { stock: 1 });
    const line = { variantId: variant.id, locationId: location.id, quantity: 1 };

    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () => reserveStock(t.db, [line], order())),
    );

    const succeeded = results.filter((result) => result.status === 'fulfilled');
    const failed = results.filter((result) => result.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(49);
    for (const failure of failed) {
      expect((failure as PromiseRejectedResult).reason).toBeInstanceOf(OutOfStockError);
    }

    const stock = await stockOf(variant.id, location.id);
    expect(stock).toMatchObject({ quantity: 1, reserved: 1, available: 0 });

    const reservations = await t.db
      .select()
      .from(inventoryTransactions)
      .where(
        and(
          eq(inventoryTransactions.variantId, variant.id),
          eq(inventoryTransactions.type, 'RESERVE'),
        ),
      );
    expect(reservations).toHaveLength(1);
  });

  it('never oversells under concurrent multi-unit orders', async () => {
    const { variant, location } = await createVariantWithStock(t.db, { stock: 10 });
    const quantities = [3, 3, 3, 3, 2, 2, 1, 1, 4, 5];
    const results = await Promise.allSettled(
      quantities.map((quantity) =>
        reserveStock(t.db, [{ variantId: variant.id, locationId: location.id, quantity }], order()),
      ),
    );
    const reserved = quantities
      .filter((_, index) => results[index]!.status === 'fulfilled')
      .reduce((sum, quantity) => sum + quantity, 0);

    const stock = await stockOf(variant.id, location.id);
    expect(stock.reserved).toBe(reserved);
    expect(stock.reserved).toBeLessThanOrEqual(10);
    expect(stock.available).toBe(10 - reserved);
  });

  it('reserves all lines of an order or none of them', async () => {
    const a = await createVariantWithStock(t.db, { stock: 5 });
    const b = await createVariantWithStock(t.db, { stock: 1 });

    const error = await reserveStock(
      t.db,
      [
        { variantId: a.variant.id, locationId: a.location.id, quantity: 2 },
        { variantId: b.variant.id, locationId: b.location.id, quantity: 2 },
      ],
      order(),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OutOfStockError);
    expect((error as OutOfStockError).shortages).toEqual([
      { variantId: b.variant.id, locationId: b.location.id, requested: 2, available: 1 },
    ]);
    expect((await stockOf(a.variant.id, a.location.id)).reserved).toBe(0);
    expect((await stockOf(b.variant.id, b.location.id)).reserved).toBe(0);
  });

  it('merges duplicate lines before checking stock', async () => {
    const { variant, location } = await createVariantWithStock(t.db, { stock: 2 });
    const line = { variantId: variant.id, locationId: location.id, quantity: 2 };
    await expect(reserveStock(t.db, [line, line], order())).rejects.toBeInstanceOf(OutOfStockError);
    expect((await stockOf(variant.id, location.id)).reserved).toBe(0);
  });

  it('moves stock through reserve, commit, release and return', async () => {
    const { variant, location } = await createVariantWithStock(t.db, { stock: 3 });
    const line = (quantity: number) => [
      { variantId: variant.id, locationId: location.id, quantity },
    ];

    await reserveStock(t.db, line(2), order());
    await commitStock(t.db, line(1), order());
    expect(await stockOf(variant.id, location.id)).toMatchObject({
      quantity: 2,
      reserved: 1,
      available: 1,
    });

    await releaseStock(t.db, line(1), order());
    expect(await stockOf(variant.id, location.id)).toMatchObject({
      quantity: 2,
      reserved: 0,
      available: 2,
    });

    await returnStock(t.db, line(1), order());
    expect(await stockOf(variant.id, location.id)).toMatchObject({
      quantity: 3,
      reserved: 0,
      available: 3,
    });

    await expect(releaseStock(t.db, line(1), order())).rejects.toBeInstanceOf(
      InventoryConflictError,
    );
  });

  it('does not let a manual stock take drop below units reserved by orders', async () => {
    const { variant, location } = await createVariantWithStock(t.db, { stock: 3 });
    await reserveStock(
      t.db,
      [{ variantId: variant.id, locationId: location.id, quantity: 2 }],
      order(),
    );

    await expect(
      setStockLevel(t.db, { variantId: variant.id, locationId: location.id, quantity: 1 }, order()),
    ).rejects.toBeInstanceOf(InventoryConflictError);

    await setStockLevel(
      t.db,
      { variantId: variant.id, locationId: location.id, quantity: 2 },
      order(),
    );
    expect(await stockOf(variant.id, location.id)).toMatchObject({
      quantity: 2,
      reserved: 2,
      available: 0,
    });
  });

  it('rejects writes that would break stock invariants even without the repository', async () => {
    const { variant, location } = await createVariantWithStock(t.db, { stock: 1 });
    expect(
      describePgError(
        await dbError(
          t.db
            .update(inventory)
            .set({ reserved: 2 })
            .where(and(eq(inventory.variantId, variant.id), eq(inventory.locationId, location.id))),
        ),
      ),
    ).toMatch(/inventory_reserved_range/);
    expect(
      describePgError(
        await dbError(
          t.db
            .update(inventory)
            .set({ quantity: -1 })
            .where(and(eq(inventory.variantId, variant.id), eq(inventory.locationId, location.id))),
        ),
      ),
    ).toMatch(/inventory_/);
  });

  it('applies marketplace sales without taking units reserved by our buyers', async () => {
    const { variant, location } = await createVariantWithStock(t.db, { stock: 5 });
    const key = { variantId: variant.id, locationId: location.id };
    const sync = { refType: 'sync_run', refId: randomUUID() };
    await reserveStock(t.db, [{ ...key, quantity: 2 }], order());

    expect(await applySyncDelta(t.db, { ...key, delta: -1 }, sync)).toEqual({
      before: 5,
      after: 4,
      clamped: false,
      available: 2,
    });
    // WB sold 4 more, but 2 units are promised to our buyers: stock stops at 2 and says so.
    expect(await applySyncDelta(t.db, { ...key, delta: -4 }, sync)).toEqual({
      before: 4,
      after: 2,
      clamped: true,
      available: 0,
    });
    expect(await applySyncDelta(t.db, { ...key, delta: 3 }, sync)).toMatchObject({
      after: 5,
      available: 3,
    });
    const ledger = await t.db
      .select({ type: inventoryTransactions.type, delta: inventoryTransactions.quantityDelta })
      .from(inventoryTransactions)
      .where(
        and(
          eq(inventoryTransactions.variantId, variant.id),
          eq(inventoryTransactions.type, 'SYNC'),
        ),
      )
      .orderBy(inventoryTransactions.id);
    expect(ledger.map((row) => row.delta)).toEqual([-1, -2, 3]);
    expect(
      await applySyncDelta(
        t.db,
        { variantId: randomUUID(), locationId: location.id, delta: 1 },
        sync,
      ),
    ).toBeNull();
  });

  it('keeps the stock ledger append-only', async () => {
    const { variant } = await createVariantWithStock(t.db, { stock: 1 });
    expect(
      describePgError(
        await dbError(
          t.db.execute(
            sql`update inventory_transactions set quantity_delta = 100 where variant_id = ${variant.id}`,
          ),
        ),
      ),
    ).toMatch(/append-only/);
    expect(
      describePgError(
        await dbError(
          t.db.execute(sql`delete from inventory_transactions where variant_id = ${variant.id}`),
        ),
      ),
    ).toMatch(/append-only/);
  });
});
