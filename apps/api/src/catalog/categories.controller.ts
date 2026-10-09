import { Controller, Get, Header, Inject } from '@nestjs/common';
import {
  type Category,
  categoryTreeSchema,
  type City,
  cityListSchema,
  type Color,
  colorListSchema,
  minDiscountSchema,
  type SizeChart,
  sizeChartListSchema,
} from '@lastsize/contracts';
import {
  asc,
  categories,
  cities,
  colors,
  type Database,
  eq,
  platformSettings,
  sizeCharts,
  sizeValues,
} from '@lastsize/db';
import { Public } from '../auth/decorators';
import { DATABASE } from '../infrastructure/infrastructure.module';

@Controller()
export class CategoriesController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Active category tree with Russian and Kazakh names. Public and cacheable. */
  @Public()
  @Get('categories')
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

  /** Cities where stores can be located. */
  @Public()
  @Get('cities')
  @Header('cache-control', 'public, max-age=300, s-maxage=3600')
  async cities(): Promise<City[]> {
    const rows = await this.db.select().from(cities).orderBy(asc(cities.id));
    return cityListSchema.parse(
      rows.map((city) => ({
        id: city.id,
        slug: city.slug,
        name: { ru: city.nameRu, kk: city.nameKk },
      })),
    );
  }

  /** Size systems with their values, in display order. */
  @Public()
  @Get('size-charts')
  @Header('cache-control', 'public, max-age=300, s-maxage=3600')
  async sizeCharts(): Promise<SizeChart[]> {
    const [charts, values] = await Promise.all([
      this.db.select().from(sizeCharts).orderBy(asc(sizeCharts.id)),
      this.db.select().from(sizeValues).orderBy(asc(sizeValues.chartId), asc(sizeValues.position)),
    ]);
    return sizeChartListSchema.parse(
      charts.map((chart) => ({
        id: chart.id,
        code: chart.code,
        name: { ru: chart.nameRu, kk: chart.nameKk },
        values: values
          .filter((value) => value.chartId === chart.id)
          .map((value) => ({ id: value.id, code: value.code })),
      })),
    );
  }

  @Public()
  @Get('colors')
  @Header('cache-control', 'public, max-age=300, s-maxage=3600')
  async colors(): Promise<Color[]> {
    const rows = await this.db.select().from(colors).orderBy(asc(colors.id));
    return colorListSchema.parse(
      rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: { ru: row.nameRu, kk: row.nameKk },
        hex: row.hex,
      })),
    );
  }

  /** The minimum discount for publishing, shown in the seller form. */
  @Public()
  @Get('settings/min-discount')
  @Header('cache-control', 'public, max-age=60')
  async minDiscount(): Promise<{ minDiscountPercent: number }> {
    const [row] = await this.db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'catalog.min_discount_percent'));
    return minDiscountSchema.parse({ minDiscountPercent: Number(row?.value ?? 30) });
  }
}
