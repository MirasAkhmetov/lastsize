import { Controller, Get, Inject, Param } from '@nestjs/common';
import { type SellerStore, sellerStoreSchema } from '@lastsize/contracts';
import { and, type Database, eq, storeMembers, stores } from '@lastsize/db';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth, RequireStoreAccess } from '../auth/decorators';
import { DATABASE } from '../infrastructure/infrastructure.module';

@Controller('seller/stores')
export class SellerStoresController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Stores the signed-in user belongs to. */
  @Get()
  async mine(@CurrentAuth() auth: AuthContext): Promise<SellerStore[]> {
    const rows = await this.db
      .select({
        id: stores.id,
        slug: stores.slug,
        name: stores.name,
        status: stores.status,
        role: storeMembers.role,
      })
      .from(storeMembers)
      .innerJoin(stores, eq(stores.id, storeMembers.storeId))
      .where(eq(storeMembers.userId, auth.user.id));
    return rows.map((row) => sellerStoreSchema.parse(row));
  }

  @Get(':storeId')
  @RequireStoreAccess()
  async one(
    @CurrentAuth() auth: AuthContext,
    @Param('storeId') storeId: string,
  ): Promise<SellerStore> {
    // The guard already proved membership; the query is scoped by user as a second line of defence.
    const [row] = await this.db
      .select({
        id: stores.id,
        slug: stores.slug,
        name: stores.name,
        status: stores.status,
        role: storeMembers.role,
      })
      .from(storeMembers)
      .innerJoin(stores, eq(stores.id, storeMembers.storeId))
      .where(and(eq(storeMembers.userId, auth.user.id), eq(stores.id, storeId)));
    return sellerStoreSchema.parse(row);
  }
}
