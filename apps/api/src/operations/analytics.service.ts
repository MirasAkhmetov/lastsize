import { Inject, Injectable } from '@nestjs/common';
import type { PlatformAnalytics, StoreAnalytics } from '@lastsize/contracts';
import { type Database, type SQL, sql } from '@lastsize/db';
import { DATABASE } from '../infrastructure/infrastructure.module';

const ratio = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((part / whole) * 1000) / 1000;
const num = (value: unknown) => Number(value ?? 0);

/**
 * Numbers for the platform and for each store, straight from the order tables. Money is goods
 * value of completed orders minus accepted returns; the platform takes no payments.
 */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async platform(days: number): Promise<PlatformAnalytics> {
    const since = sql`now() - make_interval(days => ${days})`;
    const totals = await this.totals(sql`TRUE`, since);
    const [{ placed }] = (
      await this.db.execute<{ placed: string }>(
        sql`SELECT count(*) AS placed FROM orders WHERE created_at >= ${since}`,
      )
    ).rows as [{ placed: string }];
    const [{ stores, products }] = (
      await this.db.execute<{ stores: string; products: string }>(sql`
        SELECT count(DISTINCT s.id) AS stores, count(p.id) AS products
        FROM stores s JOIN products p ON p.store_id = s.id AND p.status IN ('ACTIVE', 'FLAGGED')
        WHERE s.status = 'VERIFIED'`)
    ).rows as [{ stores: string; products: string }];
    const weekly = await this.db.execute<{ week: string; completed: string }>(sql`
      SELECT to_char(w.week, 'YYYY-MM-DD') AS week, count(so.id) AS completed
      FROM generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') AS w(week)
      LEFT JOIN seller_orders so ON so.status = 'COMPLETED' AND date_trunc('week', so.completed_at) = w.week
      GROUP BY w.week ORDER BY w.week`);
    const review = await this.db.execute<{
      id: string;
      name: string;
      orders: string;
      cancelled: string;
    }>(sql`
      SELECT s.id, s.name, count(*) AS orders,
             count(*) FILTER (WHERE so.status = 'CANCELLED' AND so.cancel_reason LIKE 'store.%') AS cancelled
      FROM seller_orders so JOIN stores s ON s.id = so.store_id
      WHERE so.created_at >= now() - interval '7 days'
      GROUP BY s.id, s.name
      HAVING count(*) >= 5
         AND count(*) FILTER (WHERE so.status = 'CANCELLED' AND so.cancel_reason LIKE 'store.%') * 10 > count(*)
      ORDER BY cancelled DESC LIMIT 20`);
    return {
      days,
      ordersPlaced: num(placed),
      ...totals,
      activeStores: num(stores),
      activeProducts: num(products),
      weekly: weekly.rows.map((row) => ({ weekStart: row.week, completed: num(row.completed) })),
      storesToReview: review.rows.map((row) => ({
        storeId: row.id,
        name: row.name,
        orders: num(row.orders),
        cancelled: num(row.cancelled),
        cancelRate: ratio(num(row.cancelled), num(row.orders)),
      })),
    };
  }

  async store(storeId: string, days: number): Promise<StoreAnalytics> {
    const since = sql`now() - make_interval(days => ${days})`;
    const totals = await this.totals(sql`so.store_id = ${storeId}`, since);
    const top = await this.db.execute<{ title: string; units: string; revenue: string }>(sql`
      SELECT oi.title, sum(oi.quantity) AS units, sum(oi.quantity * oi.unit_price) AS revenue
      FROM order_items oi JOIN seller_orders so ON so.id = oi.seller_order_id
      WHERE so.store_id = ${storeId} AND so.status = 'COMPLETED' AND so.completed_at >= ${since}
      GROUP BY oi.title ORDER BY units DESC, revenue DESC LIMIT 5`);
    return {
      days,
      orders: totals.sellerOrders,
      completed: totals.completed,
      cancelled: totals.cancelled,
      cancelRate: totals.cancelRate,
      revenue: totals.gmvCompleted,
      returnsAccepted: totals.returnsAccepted,
      medianConfirmMinutes: totals.medianConfirmMinutes,
      topProducts: top.rows.map((row) => ({
        title: row.title,
        units: num(row.units),
        revenue: num(row.revenue),
      })),
    };
  }

  private async totals(scope: SQL, since: SQL) {
    const [row] = (
      await this.db.execute<Record<string, string | null>>(sql`
        SELECT
          count(*) AS seller_orders,
          count(*) FILTER (WHERE so.status = 'CANCELLED') AS cancelled,
          count(*) FILTER (WHERE so.cancel_reason = 'store.outOfStock') AS out_of_stock,
          (SELECT count(*) FROM seller_orders so WHERE ${scope} AND so.status = 'COMPLETED' AND so.completed_at >= ${since}) AS completed,
          (SELECT coalesce(sum(oi.quantity * oi.unit_price), 0) FROM order_items oi
             JOIN seller_orders so ON so.id = oi.seller_order_id
             WHERE ${scope} AND so.status = 'COMPLETED' AND so.completed_at >= ${since}) AS sold,
          (SELECT coalesce(sum(r.quantity * oi.unit_price), 0) FROM return_items r
             JOIN order_items oi ON oi.id = r.order_item_id
             JOIN seller_orders so ON so.id = oi.seller_order_id
             WHERE ${scope} AND r.status = 'ACCEPTED' AND so.completed_at >= ${since}) AS returned_value,
          (SELECT count(*) FROM return_items r
             JOIN order_items oi ON oi.id = r.order_item_id
             JOIN seller_orders so ON so.id = oi.seller_order_id
             WHERE ${scope} AND r.status = 'ACCEPTED' AND r.created_at >= ${since}) AS returns_accepted,
          (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM h.created_at - so.created_at) / 60)
             FROM seller_orders so
             JOIN seller_order_status_history h ON h.seller_order_id = so.id AND h.to_status = 'CONFIRMED'
             WHERE ${scope} AND so.created_at >= ${since}) AS median_confirm
        FROM seller_orders so
        WHERE ${scope} AND so.created_at >= ${since}`)
    ).rows;
    const sellerOrders = num(row?.seller_orders);
    const cancelled = num(row?.cancelled);
    return {
      sellerOrders,
      completed: num(row?.completed),
      cancelled,
      cancelRate: ratio(cancelled, sellerOrders),
      outOfStockRate: ratio(num(row?.out_of_stock), sellerOrders),
      gmvCompleted: num(row?.sold) - num(row?.returned_value),
      returnsAccepted: num(row?.returns_accepted),
      medianConfirmMinutes:
        row?.median_confirm === null || row?.median_confirm === undefined
          ? null
          : Math.round(Number(row.median_confirm)),
    };
  }
}
