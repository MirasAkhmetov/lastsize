import {
  buttonClasses,
  cn,
  DiscountBadge,
  EmptyState,
  formatPrice,
  Pill,
  ProductImage,
} from '@lastsize/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ProductActions } from '@/components/product-actions';
import { dateTime } from '@/components/store-labels';
import { getProductFeed } from '@/server/api';

export const metadata: Metadata = { title: 'Лента товаров' };

const FILTERS = [
  {
    value: 'flagged',
    label: 'С флагами',
    hint: 'Система нашла признаки нечестной цены. Товары видны покупателям, пока вы не решите.',
  },
  {
    value: 'recent',
    label: 'Новые в продаже',
    hint: 'Товары публикуются сразу. Просматривайте новые и снимайте то, что нарушает правила.',
  },
  {
    value: 'removed',
    label: 'Снятые',
    hint: 'Снятые модераторами товары. «Вернуть» делает товар скрытым: продавец опубликует его сам.',
  },
] as const;

const FLAG_LABEL: Record<string, string> = {
  'price.originalRaised': 'Цена до скидки поднята > 10%',
  'discount.suspiciousForNewStore': 'Скидка 80%+ у нового магазина',
};

const PAGE_SIZE = 25;

export default async function ProductsFeedPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const query = await searchParams;
  const filter = FILTERS.find((f) => f.value === query.filter)?.value ?? 'flagged';
  const page = Math.max(1, Math.min(4000, Number.parseInt(query.page ?? '1', 10) || 1));
  const data = await getProductFeed(filter, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  return (
    <div className="grid gap-5">
      <h1 className="text-2xl font-bold">Лента товаров</h1>
      <nav aria-label="Фильтр" className="flex gap-5 overflow-x-auto border-b border-line text-sm">
        {FILTERS.map((item) => (
          <Link
            key={item.value}
            href={`/products?filter=${item.value}`}
            aria-current={item.value === filter ? 'page' : undefined}
            className={cn(
              'border-b-2 py-2 whitespace-nowrap',
              item.value === filter
                ? 'border-ink font-semibold'
                : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <p className="text-[13px] text-muted">{FILTERS.find((f) => f.value === filter)!.hint}</p>

      {!data || data.items.length === 0 ? (
        <EmptyState title="Здесь пусто" description="Товаров в этом разделе нет." />
      ) : (
        <ul className="grid gap-2">
          {data.items.map((item) => (
            <li
              key={item.id}
              className="grid grid-cols-[56px_1fr] gap-3 rounded-xl border border-line bg-surface p-3 md:grid-cols-[56px_1fr_170px_220px] md:items-center"
            >
              <div className="aspect-[3/4] overflow-hidden rounded-img bg-photo-1">
                {item.image && <ProductImage url={item.image.url} alt="" sizes="56px" />}
              </div>
              <div className="grid min-w-0 gap-0.5">
                <p className="truncate font-semibold">
                  {item.brand} · {item.title}
                </p>
                <p className="truncate text-[12.5px] text-muted">
                  <Link
                    href={`/sellers/${item.storeId}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {item.storeName}
                  </Link>{' '}
                  · {dateTime.format(new Date(item.createdAt))}
                </p>
                <div className="flex flex-wrap gap-1">
                  {item.flagReason?.split(',').map((flag) => (
                    <Pill key={flag} tone="warn">
                      {FLAG_LABEL[flag] ?? flag}
                    </Pill>
                  ))}
                  {item.removedReason && <Pill tone="sale">Снят: {item.removedReason}</Pill>}
                </div>
              </div>
              <div className="col-start-2 flex items-center gap-2 text-[13px] tabular-nums md:col-start-auto">
                <span className="font-bold">{formatPrice(item.salePrice)}</span>
                <s className="text-muted">{formatPrice(item.originalPrice)}</s>
                <DiscountBadge percent={item.discountPercent} />
              </div>
              <div className="col-start-2 md:col-start-auto">
                <ProductActions productId={item.id} status={item.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav aria-label="Страницы" className="flex items-center gap-3 text-[13px]">
          {page > 1 && (
            <Link
              href={`/products?filter=${filter}&page=${page - 1}`}
              className={buttonClasses('ghost', 'sm')}
            >
              ← Назад
            </Link>
          )}
          <span className="text-muted tabular-nums">
            {page} из {pages}
          </span>
          {page < pages && (
            <Link
              href={`/products?filter=${filter}&page=${page + 1}`}
              className={buttonClasses('ghost', 'sm')}
            >
              Дальше →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
