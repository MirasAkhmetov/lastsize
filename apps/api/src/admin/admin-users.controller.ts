import { Controller, Get, Inject, Query } from '@nestjs/common';
import { type AdminUserList, adminUserListSchema, pageQuerySchema } from '@lastsize/contracts';
import { count, type Database, desc, inArray, userRoles, users } from '@lastsize/db';
import type { z } from 'zod';
import { RequirePermissions } from '../auth/decorators';
import { DATABASE } from '../infrastructure/infrastructure.module';
import { ZodValidationPipe } from '../security/zod-validation.pipe';

@Controller('admin/users')
export class AdminUsersController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  @RequirePermissions('admin:access', 'user:read')
  async list(
    @Query(new ZodValidationPipe(pageQuerySchema)) page: z.output<typeof pageQuerySchema>,
  ): Promise<AdminUserList> {
    const [rows, [{ total } = { total: 0 }]] = await Promise.all([
      this.db
        .select({
          id: users.id,
          name: users.name,
          phone: users.phone,
          status: users.status,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(desc(users.createdAt))
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ total: count() }).from(users),
    ]);
    const roleRows = rows.length
      ? await this.db
          .select()
          .from(userRoles)
          .where(
            inArray(
              userRoles.userId,
              rows.map((row) => row.id),
            ),
          )
      : [];
    // Explicit field list: password hashes and TOTP seeds are never selected for responses.
    return adminUserListSchema.parse({
      total,
      items: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        roles: roleRows.filter((role) => role.userId === row.id).map((role) => role.roleCode),
      })),
    });
  }
}
