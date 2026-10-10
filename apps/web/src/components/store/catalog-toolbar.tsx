'use client';

import { CATALOG_SORTS, type CatalogQuery, type CatalogResponse } from '@lastsize/contracts';
import { Button, Chip, Sheet } from '@lastsize/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { CatalogFilters, useCatalogNavigation } from './catalog-filters';

export interface ActiveFilter {
  key: 'size' | 'brand' | 'store' | 'color' | 'priceMin' | 'priceMax' | 'discount' | 'pickup' | 'q';
  value: string;
  label: string;
}

/** Sort, the mobile filter sheet and removable chips for the active filters. */
export function CatalogToolbar({
  facets,
  query,
  active,
  total,
  hideStore = false,
}: {
  facets: CatalogResponse['facets'];
  query: Partial<CatalogQuery>;
  active: ActiveFilter[];
  total: number;
  hideStore?: boolean;
}) {
  const t = useTranslations('catalog');
  const navigate = useCatalogNavigation();
  const [open, setOpen] = useState(false);

  const remove = (filter: ActiveFilter) =>
    navigate((params) => {
      if (
        filter.key === 'size' ||
        filter.key === 'brand' ||
        filter.key === 'store' ||
        filter.key === 'color'
      ) {
        const rest = (params.get(filter.key) ?? '')
          .split(',')
          .filter((v) => v && v !== filter.value);
        if (rest.length) params.set(filter.key, rest.join(','));
        else params.delete(filter.key);
      } else params.delete(filter.key);
    });

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="md:hidden" onClick={() => setOpen(true)}>
          {t('filters')}
          {active.length > 0 && (
            <span className="rounded-full bg-ink px-1.5 text-[11px] text-paper">
              {active.length}
            </span>
          )}
        </Button>
        <span className="hidden text-[13px] text-muted tabular-nums md:inline">
          {t('found', { count: total })}
        </span>
        <label className="ml-auto flex items-center gap-2 text-[13px]">
          <span className="sr-only md:not-sr-only md:text-muted">{t('sort')}</span>
          <select
            value={query.sort ?? 'newest'}
            onChange={(event) =>
              navigate((params) =>
                event.target.value === 'newest'
                  ? params.delete('sort')
                  : params.set('sort', event.target.value),
              )
            }
            className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px]"
          >
            {CATALOG_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {t(`sorts.${sort}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {active.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {active.map((filter) => (
            <Chip key={`${filter.key}-${filter.value}`} active onClick={() => remove(filter)}>
              {filter.label} ✕
            </Chip>
          ))}
          <Button
            variant="text"
            size="sm"
            onClick={() =>
              navigate((params) =>
                [...params.keys()].filter((k) => k !== 'sort').forEach((k) => params.delete(k)),
              )
            }
          >
            {t('reset')}
          </Button>
        </div>
      )}
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={t('filters')}
        footer={
          <Button block onClick={() => setOpen(false)}>
            {t('showResults')} · {total}
          </Button>
        }
      >
        <CatalogFilters facets={facets} query={query} hideStore={hideStore} />
      </Sheet>
    </div>
  );
}
