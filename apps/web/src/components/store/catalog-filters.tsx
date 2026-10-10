'use client';

import type { CatalogQuery, CatalogResponse } from '@lastsize/contracts';
import { Button, Chip, cn } from '@lastsize/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';

type Facets = CatalogResponse['facets'];
type ListKey = 'size' | 'brand' | 'store' | 'color';

/** Writes filter changes to the URL; the server page re-renders with the new results. */
export function useCatalogNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (change: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    change(params);
    params.delete('page');
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-2 border-b border-line py-3">
      <legend className="pb-2 text-[13px] font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

export function CatalogFilters({
  facets,
  query,
  hideStore = false,
}: {
  facets: Facets;
  query: Partial<CatalogQuery>;
  hideStore?: boolean;
}) {
  const t = useTranslations('catalog');
  const lang = useLocale() === 'kk' ? 'kk' : 'ru';
  const navigate = useCatalogNavigation();
  const [showAllBrands, setShowAllBrands] = useState(false);

  const toggle = (key: ListKey, value: string) =>
    navigate((params) => {
      const current = new Set((params.get(key) ?? '').split(',').filter(Boolean));
      if (current.has(value)) current.delete(value);
      else current.add(value);
      if (current.size) params.set(key, [...current].join(','));
      else params.delete(key);
    });
  const selected = (key: ListKey, value: string) =>
    (query[key] as string[] | undefined)?.includes(value) ?? false;
  const setValue = (key: 'discount' | 'pickup', value: string | null) =>
    navigate((params) => (value === null ? params.delete(key) : params.set(key, value)));

  function applyPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    navigate((params) => {
      for (const key of ['priceMin', 'priceMax'] as const) {
        const value = String(data.get(key) ?? '').replace(/\D/g, '');
        if (value) params.set(key, value);
        else params.delete(key);
      }
    });
  }

  const charts = [...new Set(facets.sizes.map((size) => size.chart))];
  const brands = showAllBrands ? facets.brands : facets.brands.slice(0, 8);

  return (
    <div className="grid">
      {charts.map((chart) => (
        <Group key={chart} title={t(`facetSizes.${chart}` as 'facetSizes.SHOES_EU')}>
          <div className="flex flex-wrap gap-1.5">
            {facets.sizes
              .filter((size) => size.chart === chart)
              .map((size) => (
                <button
                  key={size.value}
                  type="button"
                  aria-pressed={selected('size', size.value)}
                  onClick={() => toggle('size', size.value)}
                  className={cn(
                    'h-9 min-w-10 rounded-lg border px-2 text-[13px] tabular-nums',
                    selected('size', size.value)
                      ? 'border-2 border-ink font-semibold'
                      : 'border-line hover:border-ink',
                  )}
                >
                  {size.label}
                </button>
              ))}
          </div>
        </Group>
      ))}

      <Group title={t('facetDiscount')}>
        <div className="flex flex-wrap gap-1.5">
          {[30, 50, 70].map((value) => (
            <Chip
              key={value}
              active={query.discount === value}
              onClick={() => setValue('discount', query.discount === value ? null : String(value))}
            >
              {t('discountFrom', { value })}
            </Chip>
          ))}
        </div>
      </Group>

      {facets.price && (
        <Group title={t('facetPrice')}>
          <form
            onSubmit={applyPrice}
            className="flex items-center gap-2"
            key={`${query.priceMin}-${query.priceMax}`}
          >
            <input
              name="priceMin"
              inputMode="numeric"
              aria-label={t('priceFrom')}
              placeholder={`${t('priceFrom')} ${facets.price.min}`}
              defaultValue={query.priceMin ?? ''}
              className="w-full min-w-0 rounded-lg border border-line bg-surface px-2.5 py-2 text-[13px] tabular-nums"
            />
            <input
              name="priceMax"
              inputMode="numeric"
              aria-label={t('priceTo')}
              placeholder={`${t('priceTo')} ${facets.price.max}`}
              defaultValue={query.priceMax ?? ''}
              className="w-full min-w-0 rounded-lg border border-line bg-surface px-2.5 py-2 text-[13px] tabular-nums"
            />
            <Button type="submit" size="sm" variant="ghost">
              ✓
            </Button>
          </form>
        </Group>
      )}

      <Group title={t('facetPickup')}>
        <label className="flex items-center gap-2 text-[13.5px]">
          <input
            type="checkbox"
            checked={query.pickup === '1'}
            onChange={(event) => setValue('pickup', event.target.checked ? '1' : null)}
          />
          {t('pickupOnly')}
        </label>
      </Group>

      {facets.brands.length > 0 && (
        <Group title={t('facetBrand')}>
          {brands.map((brand) => (
            <label key={brand.value} className="flex items-center gap-2 text-[13.5px]">
              <input
                type="checkbox"
                checked={selected('brand', brand.value)}
                onChange={() => toggle('brand', brand.value)}
              />
              <span className="flex-1">{brand.label}</span>
              <span className="text-[12px] text-muted tabular-nums">{brand.count}</span>
            </label>
          ))}
          {facets.brands.length > 8 && (
            <Button
              variant="text"
              size="sm"
              className="justify-self-start"
              onClick={() => setShowAllBrands((v) => !v)}
            >
              {showAllBrands ? '−' : `+ ${facets.brands.length - 8}`}
            </Button>
          )}
        </Group>
      )}

      {!hideStore && facets.stores.length > 1 && (
        <Group title={t('facetStore')}>
          {facets.stores.map((store) => (
            <label key={store.value} className="flex items-center gap-2 text-[13.5px]">
              <input
                type="checkbox"
                checked={selected('store', store.value)}
                onChange={() => toggle('store', store.value)}
              />
              <span className="flex-1">{store.label}</span>
              <span className="text-[12px] text-muted tabular-nums">{store.count}</span>
            </label>
          ))}
        </Group>
      )}

      {facets.colors.length > 0 && (
        <Group title={t('facetColor')}>
          <div className="flex flex-wrap gap-1.5">
            {facets.colors.map((color) => (
              <Chip
                key={color.value}
                active={selected('color', color.value)}
                onClick={() => toggle('color', color.value)}
              >
                <span
                  aria-hidden
                  className="size-3 rounded-full border border-line"
                  style={{
                    background:
                      color.hex ?? 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
                  }}
                />
                {lang === 'kk' ? color.labelKk : color.label}
              </Chip>
            ))}
          </div>
        </Group>
      )}
    </div>
  );
}
