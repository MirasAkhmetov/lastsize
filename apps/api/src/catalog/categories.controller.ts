import { Controller, Get, Header, Inject } from '@nestjs/common';
import { type Category, categoryTreeSchema } from '@lastsize/contracts';
import { asc, categories, type Database, eq, sizeCharts } from '@lastsize/db';
import { Public } from '../auth/decorators';
import { DATABASE } from '../infrastructure/infrastructure.module';

@Controller('categories')
export class CategoriesController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Active category tree with Russian and Kazakh names. Public and cacheable. */
  @Public()
  @Get()
  @Header('cache-control', 'public, max-age=60, s-maxage=300')
  async tree(): Promise<Category[]> {
    const rows = await this.db
      .select({
        id: categories.id,
        parentId: categories.parentId,
        slug: categories.slug,
        nameRu: categories.nameRu,
        nameKk: categories.nameKk,
        sizeChart: sizeCharts.code,
      })
      .from(categories)
      .leftJoin(sizeCharts, eq(sizeCharts.id, categories.sizeChartId))
      .where(eq(categories.isActive, true))
      .orderBy(asc(categories.position));

    const byParent = new Map<number | null, typeof rows>();
    for (const row of rows) {
      const siblings = byParent.get(row.parentId) ?? [];
      siblings.push(row);
      byParent.set(row.parentId, siblings);
    }
    const build = (parentId: number | null): Category[] =>
      (byParent.get(parentId) ?? []).map((row) => ({
        id: row.id,
        slug: row.slug,
        name: { ru: row.nameRu, kk: row.nameKk },
        sizeChart: row.sizeChart,
        children: build(row.id),
      }));
    return categoryTreeSchema.parse(build(null));
  }
}
