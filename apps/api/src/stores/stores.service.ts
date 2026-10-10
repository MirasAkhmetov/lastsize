import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AdminStoreDetail,
  AdminStoreList,
  StoreDetail,
  StoreStatus,
} from '@lastsize/contracts';
import {
  and,
  auditLogs,
  cities,
  count,
  type Database,
  desc,
  eq,
  inArray,
  sql,
  storeLocations,
  storeMembers,
  stores,
  type StoreSchedule,
  type Transaction,
  users,
} from '@lastsize/db';
import { allowedFrom, nextStoreStatus, type StoreTransition, uniqueSlug } from '@lastsize/domain';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { DATABASE } from '../infrastructure/infrastructure.module';
import { ValidationFailedException } from '../security/zod-validation.pipe';

export interface StoreLocationInput {
  cityId: number;
  address: string;
  phone: string;
  schedule: StoreSchedule;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
}

/** Buyers must have at least one way to receive an order: pickup or courier. */
function assertReceivable(location: { pickupEnabled?: boolean; deliveryEnabled?: boolean }) {
  if (location.pickupEnabled === false && location.deliveryEnabled === false)
    throw new ValidationFailedException([
      { path: 'location.deliveryEnabled', message: 'fulfillment.none' },
    ]);
}

export interface CreateStoreInput {
  name: string;
  legalName?: string;
  binIin: string;
  description?: string;
  instagram?: string;
  location: StoreLocationInput;
}

export type UpdateStoreInput = Partial<Omit<CreateStoreInput, 'location'>> & {
  location?: Partial<StoreLocationInput>;
};

type Actor = { userId: string; request: FastifyRequest };

const TRANSITION_MESSAGES: Record<StoreTransition, string> = {
  verify: 'Подтвердить можно только магазин на проверке',
  reject: 'Отклонить можно только магазин на проверке',
  block: 'Магазин уже заблокирован',
  unblock: 'Магазин не заблокирован',
  resubmit: 'Магазин не отклонён',
  legalDataChanged: 'Магазин не подтверждён',
};

@Injectable()
export class StoresService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async listCities() {
    const rows = await this.db.select().from(cities).orderBy(cities.id);
    return rows.map((city) => ({
      id: city.id,
      slug: city.slug,
      name: { ru: city.nameRu, kk: city.nameKk },
    }));
  }

  /**
   * Creates a store under review with the user as owner. One owned store per seller for now;
   * an advisory lock per user makes the check safe against double submission.
   */
  async create(input: CreateStoreInput, actor: Actor): Promise<string> {
    await this.assertCity(input.location.cityId);
    assertReceivable(input.location);
    const storeId = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`store-owner:${actor.userId}`}))`,
      );
      const [owned] = await tx
        .select({ total: count() })
        .from(storeMembers)
        .where(and(eq(storeMembers.userId, actor.userId), eq(storeMembers.role, 'SELLER')));
      if ((owned?.total ?? 0) > 0) throw new ConflictException('У вас уже есть магазин');

      const slug = await uniqueSlug(input.name, async (candidate) => {
        const [taken] = await tx
          .select({ id: stores.id })
          .from(stores)
          .where(eq(stores.slug, candidate));
        return Boolean(taken);
      });
      const [store] = await tx
        .insert(stores)
        .values({
          slug,
          name: input.name,
          legalName: input.legalName ?? null,
          binIin: input.binIin,
          description: input.description ?? null,
          instagram: input.instagram ?? null,
        })
        .returning({ id: stores.id });
      await tx.insert(storeLocations).values({ storeId: store!.id, ...input.location });
      await tx
        .insert(storeMembers)
        .values({ storeId: store!.id, userId: actor.userId, role: 'SELLER' });
      return store!.id;
    });
    await this.audit.record(
      {
        action: 'store.created',
        actorType: 'USER',
        actorId: actor.userId,
        entityType: 'store',
        entityId: storeId,
      },
      actor.request,
    );
    return storeId;
  }

  /**
   * Seller edit. A rejected store goes back to review on any change; a verified store goes back
   * to review when its legal data (BIN/IIN, legal name) changes.
   */
  async update(storeId: string, input: UpdateStoreInput, actor: Actor): Promise<void> {
    if (input.location?.cityId !== undefined) await this.assertCity(input.location.cityId);
    const transition = await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(stores).where(eq(stores.id, storeId)).for('update');
      if (!current) throw new NotFoundException('Магазин не найден');
      const legalChanged =
        (input.binIin !== undefined && input.binIin !== current.binIin) ||
        (input.legalName !== undefined && input.legalName !== (current.legalName ?? undefined));
      const transition: StoreTransition | null =
        current.status === 'REJECTED'
          ? 'resubmit'
          : current.status === 'VERIFIED' && legalChanged
            ? 'legalDataChanged'
            : null;
      const status = transition ? nextStoreStatus(transition, current.status) : current.status;

      const { location, ...profile } = input;
      await tx
        .update(stores)
        .set({
          ...profile,
          status,
          ...(transition ? { rejectionReason: null } : {}),
        })
        .where(eq(stores.id, storeId));
      if (location && Object.keys(location).length > 0) {
        const [current] = await tx
          .select({
            pickupEnabled: storeLocations.pickupEnabled,
            deliveryEnabled: storeLocations.deliveryEnabled,
          })
          .from(storeLocations)
          .where(eq(storeLocations.storeId, storeId));
        assertReceivable({ ...current!, ...location });
        await tx.update(storeLocations).set(location).where(eq(storeLocations.storeId, storeId));
      }
      return transition;
    });
    await this.audit.record(
      {
        action: transition
          ? `store.${transition === 'resubmit' ? 'resubmitted' : 'legal_data_changed'}`
          : 'store.updated',
        actorType: 'USER',
        actorId: actor.userId,
        entityType: 'store',
        entityId: storeId,
        metadata: { fields: Object.keys(input) },
      },
      actor.request,
    );
  }

  async sellerDetail(storeId: string, userId: string): Promise<StoreDetail> {
    const [row] = await this.detailQuery()
      .innerJoin(
        storeMembers,
        and(eq(storeMembers.storeId, stores.id), eq(storeMembers.userId, userId)),
      )
      .where(eq(stores.id, storeId));
    if (!row) throw new NotFoundException('Магазин не найден');
    const role = await this.db
      .select({ role: storeMembers.role })
      .from(storeMembers)
      .where(and(eq(storeMembers.storeId, storeId), eq(storeMembers.userId, userId)));
    return { ...this.toDetail(row), role: role[0]!.role };
  }

  async adminList(status: StoreStatus, limit: number, offset: number): Promise<AdminStoreList> {
    const owner = this.ownerJoin();
    const [items, [{ total } = { total: 0 }], countRows] = await Promise.all([
      this.db
        .select({
          id: stores.id,
          name: stores.name,
          slug: stores.slug,
          status: stores.status,
          city: cities.nameRu,
          ownerName: users.name,
          ownerPhone: users.phone,
          createdAt: stores.createdAt,
        })
        .from(stores)
        .innerJoin(storeLocations, eq(storeLocations.storeId, stores.id))
        .innerJoin(cities, eq(cities.id, storeLocations.cityId))
        .innerJoin(storeMembers, owner)
        .innerJoin(users, eq(users.id, storeMembers.userId))
        .where(eq(stores.status, status))
        // Oldest first in the review queue; newest first elsewhere.
        .orderBy(status === 'PENDING_VERIFICATION' ? stores.createdAt : desc(stores.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(stores).where(eq(stores.status, status)),
      this.db.select({ status: stores.status, total: count() }).from(stores).groupBy(stores.status),
    ]);
    const counts = { PENDING_VERIFICATION: 0, VERIFIED: 0, REJECTED: 0, BLOCKED: 0 } as Record<
      StoreStatus,
      number
    >;
    for (const row of countRows) counts[row.status] = row.total;
    return {
      total,
      counts,
      items: items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
    };
  }

  async adminDetail(storeId: string): Promise<AdminStoreDetail> {
    const [row] = await this.detailQuery().where(eq(stores.id, storeId));
    if (!row) throw new NotFoundException('Магазин не найден');
    const [owner] = await this.db
      .select({
        id: users.id,
        name: users.name,
        phone: users.phone,
        phoneVerifiedAt: users.phoneVerifiedAt,
      })
      .from(storeMembers)
      .innerJoin(users, eq(users.id, storeMembers.userId))
      .where(this.ownerJoin(storeId));
    const history = await this.db
      .select({
        action: auditLogs.action,
        actorName: users.name,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(and(eq(auditLogs.entityType, 'store'), eq(auditLogs.entityId, storeId)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(50);
    const { role: _role, ...detail } = { ...this.toDetail(row), role: undefined };
    return {
      ...detail,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      owner: {
        id: owner!.id,
        name: owner!.name,
        phone: owner!.phone,
        phoneVerified: owner!.phoneVerifiedAt !== null,
      },
      history: history.map((entry) => ({
        action: entry.action,
        actorName: entry.actorName,
        reason: typeof entry.metadata?.reason === 'string' ? entry.metadata.reason : null,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }

  /** Admin decision. The status check and the update are one conditional statement, so two admins cannot race. */
  async applyAdminTransition(
    storeId: string,
    transition: 'verify' | 'reject' | 'block' | 'unblock',
    actor: Actor,
    reason?: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ status: stores.status, verifiedAt: stores.verifiedAt })
        .from(stores)
        .where(eq(stores.id, storeId));
      if (!current) throw new NotFoundException('Магазин не найден');
      if (!allowedFrom(transition).includes(current.status))
        throw new ConflictException(TRANSITION_MESSAGES[transition]);
      const status = nextStoreStatus(transition, current.status, {
        wasVerified: current.verifiedAt !== null,
      });

      const [updated] = await tx
        .update(stores)
        .set({
          status,
          rejectionReason: transition === 'reject' || transition === 'block' ? reason! : null,
          ...(transition === 'verify' ? { verifiedAt: sql`now()`, verifiedBy: actor.userId } : {}),
        })
        .where(and(eq(stores.id, storeId), inArray(stores.status, [...allowedFrom(transition)])))
        .returning({ id: stores.id });
      if (!updated)
        throw new ConflictException('Статус магазина только что изменился. Обновите страницу.');

      if (transition === 'verify') await this.confirmOwnerPhone(tx, storeId);
    });
    const action = {
      verify: 'store.verified',
      reject: 'store.rejected',
      block: 'store.blocked',
      unblock: 'store.unblocked',
    }[transition];
    await this.audit.record(
      {
        action,
        actorType: 'USER',
        actorId: actor.userId,
        entityType: 'store',
        entityId: storeId,
        metadata: {
          ...(reason ? { reason } : {}),
          ...(transition === 'verify' ? { phoneConfirmed: true } : {}),
        },
      },
      actor.request,
    );
  }

  /** Verification includes a phone call to the owner, which also confirms their number. */
  private async confirmOwnerPhone(tx: Transaction, storeId: string): Promise<void> {
    await tx
      .update(users)
      .set({ phoneVerifiedAt: sql`now()` })
      .where(
        and(
          sql`${users.phoneVerifiedAt} IS NULL`,
          inArray(
            users.id,
            tx
              .select({ id: storeMembers.userId })
              .from(storeMembers)
              .where(this.ownerJoin(storeId)),
          ),
        ),
      );
  }

  private ownerJoin(storeId?: string) {
    return storeId
      ? and(eq(storeMembers.storeId, storeId), eq(storeMembers.role, 'SELLER'))
      : and(eq(storeMembers.storeId, stores.id), eq(storeMembers.role, 'SELLER'));
  }

  private async assertCity(cityId: number): Promise<void> {
    const [city] = await this.db
      .select({ id: cities.id })
      .from(cities)
      .where(eq(cities.id, cityId));
    if (!city) throw new NotFoundException('Город не найден');
  }

  private detailQuery() {
    return this.db
      .select({
        id: stores.id,
        slug: stores.slug,
        name: stores.name,
        legalName: stores.legalName,
        binIin: stores.binIin,
        description: stores.description,
        instagram: stores.instagram,
        status: stores.status,
        statusReason: stores.rejectionReason,
        verifiedAt: stores.verifiedAt,
        createdAt: stores.createdAt,
        cityId: storeLocations.cityId,
        cityRu: cities.nameRu,
        cityKk: cities.nameKk,
        address: storeLocations.address,
        phone: storeLocations.phone,
        schedule: storeLocations.schedule,
        pickupEnabled: storeLocations.pickupEnabled,
        deliveryEnabled: storeLocations.deliveryEnabled,
      })
      .from(stores)
      .innerJoin(storeLocations, eq(storeLocations.storeId, stores.id))
      .innerJoin(cities, eq(cities.id, storeLocations.cityId))
      .$dynamic();
  }

  private toDetail(
    row: Awaited<ReturnType<ReturnType<StoresService['detailQuery']>['execute']>>[number],
  ) {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      legalName: row.legalName,
      binIin: row.binIin,
      description: row.description,
      instagram: row.instagram,
      status: row.status,
      statusReason: row.status === 'REJECTED' || row.status === 'BLOCKED' ? row.statusReason : null,
      createdAt: row.createdAt.toISOString(),
      location: {
        cityId: row.cityId,
        cityName: { ru: row.cityRu, kk: row.cityKk },
        address: row.address,
        phone: row.phone,
        schedule: row.schedule,
        pickupEnabled: row.pickupEnabled,
        deliveryEnabled: row.deliveryEnabled,
      },
    };
  }
}
