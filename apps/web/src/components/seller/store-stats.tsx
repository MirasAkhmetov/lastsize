import type { StoreAnalytics } from '@lastsize/contracts';
import { formatPrice } from '@lastsize/ui';
import { getTranslations } from 'next-intl/server';

/** The store's last 30 days: sales, cancellations, speed of confirmation, best sellers. */
export async function StoreStats({ stats }: { stats: StoreAnalytics }) {
  const t = await getTranslations('sellerStats');
  const cards = [
    { label: t('revenue'), value: formatPrice(stats.revenue) },
    { label: t('completed'), value: String(stats.completed) },
    { label: t('orders'), value: String(stats.orders) },
    {
      label: t('cancelRate'),
      value: `${Math.round(stats.cancelRate * 100)}%`,
      warn: stats.cancelRate > 0.1,
    },
    {
      label: t('confirm'),
      value:
        stats.medianConfirmMinutes === null
          ? '—'
          : t('minutes', { count: stats.medianConfirmMinutes }),
      warn: stats.medianConfirmMinutes !== null && stats.medianConfirmMinutes > 30,
    },
    { label: t('returns'), value: String(stats.returnsAccepted) },
  ];
  return (
    <section className="grid gap-3">
      <h2 className="text-[15px] font-bold">{t('title', { days: stats.days })}</h2>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="grid gap-1 rounded-xl border border-line bg-surface p-3">
            <span className="text-[12px] text-muted">{card.label}</span>
            <span className={`text-xl font-bold tabular-nums ${card.warn ? 'text-warn' : ''}`}>
              {card.value}
            </span>
          </div>
        ))}
      </div>
      {stats.cancelRate > 0.1 && <p className="text-[12.5px] text-warn">{t('cancelHint')}</p>}
      {stats.topProducts.length > 0 && (
        <div className="grid gap-1 rounded-xl border border-line bg-surface p-3 text-[13px]">
          <span className="font-semibold">{t('top')}</span>
          <ol className="grid gap-0.5">
            {stats.topProducts.map((product) => (
              <li key={product.title} className="flex justify-between gap-3">
                <span className="truncate">{product.title}</span>
                <span className="tabular-nums text-muted">
                  {t('units', { count: product.units })} · {formatPrice(product.revenue)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
