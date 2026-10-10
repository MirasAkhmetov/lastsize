'use client';

import {
  ApiError,
  apiRequest,
  type Category,
  type Color,
  GENDERS,
  IMPORT_ROW_FILTERS,
  type ImportJob,
  type ImportPublishResult,
  type ImportRow,
  type ImportRowPage,
  NetworkError,
  type SizeChart,
} from '@lastsize/contracts';
import { Button, Chip, cn, Notice, Pill, SelectField, useToast } from '@lastsize/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { ImportRowItem } from './import-row';

type Filter = (typeof IMPORT_ROW_FILTERS)[number];
type Gender = (typeof GENDERS)[number];
const PAGE = 50;
const PERCENTS = [30, 40, 50, 60, 70];

export interface ImportReference {
  categories: Category[];
  sizeCharts: SizeChart[];
  colors: Color[];
  minDiscount: number;
}

interface Props extends ImportReference {
  storeId: string;
  initialJob: ImportJob;
  canPublish: boolean;
}

/** Steps 2–4 of the import: match source values, set the sale price, publish in batches. */
export function ImportWizard({ storeId, initialJob, canPublish, ...reference }: Props) {
  const t = useTranslations('imports');
  const tp = useTranslations('products');
  const validation = useTranslations('validation');
  const errors = useTranslations('errors');
  const lang = useLocale() === 'kk' ? 'kk' : 'ru';
  const router = useRouter();
  const toast = useToast();
  const base = `/seller/stores/${storeId}/imports/${initialJob.id}`;

  const [job, setJob] = useState(initialJob);
  const [filter, setFilter] = useState<Filter>(
    initialJob.counts.needsAttention > 0 ? 'attention' : 'all',
  );
  const [page, setPage] = useState<ImportRowPage>({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customPercent, setCustomPercent] = useState('');
  const [fillGender, setFillGender] = useState<Gender | ''>('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const stopRef = useRef(false);

  const describe = useCallback(
    (cause: unknown) => {
      if (cause instanceof ApiError) {
        const code = Object.values(cause.fieldErrors())[0];
        if (code) return validation.has(code) ? validation(code) : validation('generic');
        return cause.problem?.detail ?? errors('generic');
      }
      return cause instanceof NetworkError ? errors('network') : errors('generic');
    },
    [errors, validation],
  );

  const loadRows = useCallback(
    async (nextFilter: Filter, offset = 0) => {
      setLoading(true);
      try {
        const result = await apiRequest<ImportRowPage>(
          'GET',
          `${base}/rows?filter=${nextFilter}&limit=${PAGE}&offset=${offset}`,
        );
        setPage((current) =>
          offset === 0
            ? result
            : { items: [...current.items, ...result.items], total: result.total },
        );
      } catch (cause) {
        setError(describe(cause));
      } finally {
        setLoading(false);
      }
    },
    [base, describe],
  );

  useEffect(() => {
    void loadRows(filter);
  }, [filter, loadRows]);

  const refreshJob = useCallback(async () => {
    setJob(await apiRequest<ImportJob>('GET', base));
  }, [base]);

  /** Runs a job-wide change, then reloads the counts and the visible rows. */
  async function jobAction(path: string, body: unknown, done?: string) {
    setBusy(true);
    setError(null);
    try {
      setJob(await apiRequest<ImportJob>('POST', `${base}/${path}`, body));
      await loadRows(filter);
      if (done) toast({ title: done });
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  }

  const onRowChange = (row: ImportRow) => {
    setPage((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === row.id ? row : item)),
    }));
    void refreshJob();
  };

  async function publish() {
    const mode = canPublish ? 'publish' : 'draft';
    const total = job.counts.toPublish;
    if (total === 0) return;
    stopRef.current = false;
    setProgress({ done: 0, total });
    setError(null);
    let published = 0;
    let failed = 0;
    try {
      for (;;) {
        const result = await apiRequest<ImportPublishResult>('POST', `${base}/publish`, { mode });
        published += result.processed.filter((p) => p.status === 'PUBLISHED').length;
        failed += result.processed.filter((p) => p.status !== 'PUBLISHED').length;
        setProgress({ done: published + failed, total });
        if (result.remaining === 0 || result.processed.length === 0 || stopRef.current) break;
      }
      toast({ title: t('publishDone', { published, failed }) });
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setProgress(null);
      await refreshJob();
      await loadRows(filter);
      router.refresh();
    }
  }

  const categoryOptions = [
    { value: '', label: t('mapChoose') },
    ...reference.categories.flatMap((root) =>
      root.children.map((child) => ({
        value: String(child.id),
        label: child.name[lang],
        group: root.name[lang],
      })),
    ),
  ];
  const colorOptions = [
    { value: '', label: t('mapChoose') },
    ...reference.colors.map((color) => ({ value: String(color.id), label: color.name[lang] })),
  ];
  const { unmapped, counts } = job;
  const mappingNeeded =
    unmapped.categories.length + unmapped.colors.length + unmapped.sizes.length > 0 ||
    unmapped.missingGender > 0;
  const filterCount: Record<Filter, number> = {
    all: counts.total,
    attention: counts.needsAttention,
    ready: counts.ready + counts.publishing,
    published: counts.published,
    failed: counts.failed,
  };

  return (
    <div className="grid max-w-5xl gap-8">
      <ol className="flex flex-wrap gap-2 text-[13px]">
        {(['source', 'mapping', 'prices', 'publish'] as const).map((step, index) => (
          <li key={step}>
            <a
              href={`#${step}`}
              className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 hover:border-ink"
            >
              <span className="grid size-5 place-items-center rounded-full bg-ink text-[11px] text-paper">
                {index + 1}
              </span>
              {t(`steps.${step}`)}
            </a>
          </li>
        ))}
      </ol>

      <section id="source" className="grid gap-3">
        <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {(['total', 'ready', 'needsAttention', 'published', 'failed', 'skipped'] as const).map(
            (key) => (
              <div key={key} className="rounded-xl border border-line bg-surface px-3 py-2">
                <dt className="text-[12px] text-muted">{t(`counts.${key}`)}</dt>
                <dd className="text-lg font-bold tabular-nums">{counts[key]}</dd>
              </div>
            ),
          )}
        </dl>
        {job.warnings.map((code) => (
          <Notice key={code} tone="info">
            {t.has(`warnings.${code}`) ? t(`warnings.${code}`) : code}
          </Notice>
        ))}
        {error && <Notice>{error}</Notice>}
      </section>

      <section id="mapping" className="grid gap-4">
        <div className="grid gap-1">
          <h2 className="text-[15px] font-bold">{t('mapTitle')}</h2>
          <p className="text-[13px] text-muted">{mappingNeeded ? t('mapLead') : t('mapDone')}</p>
        </div>
        {unmapped.categories.length > 0 && (
          <MappingGroup title={t('mapCategories')}>
            {unmapped.categories.map((item) => (
              <MappingRow
                key={item.value}
                value={item.value}
                count={t('mapCount', { count: item.count })}
              >
                <SelectField
                  label={item.value}
                  className="[&>label]:sr-only"
                  value=""
                  disabled={busy}
                  options={categoryOptions}
                  onChange={(event) =>
                    void jobAction('mappings', {
                      kind: 'CATEGORY',
                      sourceValue: item.value,
                      targetId: Number(event.target.value),
                    })
                  }
                />
              </MappingRow>
            ))}
          </MappingGroup>
        )}
        {unmapped.colors.length > 0 && (
          <MappingGroup title={t('mapColors')}>
            {unmapped.colors.map((item) => (
              <MappingRow
                key={item.value}
                value={item.value}
                count={t('mapCount', { count: item.count })}
              >
                <SelectField
                  label={item.value}
                  className="[&>label]:sr-only"
                  value=""
                  disabled={busy}
                  options={colorOptions}
                  onChange={(event) =>
                    void jobAction('mappings', {
                      kind: 'COLOR',
                      sourceValue: item.value,
                      targetId: Number(event.target.value),
                    })
                  }
                />
              </MappingRow>
            ))}
          </MappingGroup>
        )}
        {unmapped.sizes.length > 0 && (
          <MappingGroup title={t('mapSizes')}>
            {unmapped.sizes.map((item) => {
              const chart = reference.sizeCharts.find((c) => c.code === item.chart);
              return (
                <MappingRow
                  key={`${item.chart}:${item.value}`}
                  value={item.value}
                  note={chart?.name[lang]}
                  count={t('mapCount', { count: item.count })}
                >
                  <SelectField
                    label={item.value}
                    className="[&>label]:sr-only"
                    value=""
                    disabled={busy}
                    options={[
                      { value: '', label: t('mapChoose') },
                      ...(chart?.values ?? []).map((v) => ({ value: String(v.id), label: v.code })),
                    ]}
                    onChange={(event) =>
                      void jobAction('mappings', {
                        kind: 'SIZE',
                        chart: item.chart,
                        sourceValue: item.value,
                        targetId: Number(event.target.value),
                      })
                    }
                  />
                </MappingRow>
              );
            })}
          </MappingGroup>
        )}
        {unmapped.missingGender > 0 && (
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface p-3">
            <SelectField
              label={t('genderFill', { count: unmapped.missingGender })}
              value={fillGender}
              onChange={(event) => setFillGender(event.target.value as Gender | '')}
              options={[
                { value: '', label: t('mapChoose') },
                ...GENDERS.map((value) => ({ value, label: tp(`genders.${value}`) })),
              ]}
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={!fillGender || busy}
              onClick={() => void jobAction('fill', { gender: fillGender })}
            >
              {t('apply')}
            </Button>
          </div>
        )}
      </section>

      <section id="prices" className="grid gap-3">
        <div className="grid gap-1">
          <h2 className="text-[15px] font-bold">{t('priceTitle')}</h2>
          <p className="max-w-2xl text-[13px] text-muted">
            {t('priceLead', { min: reference.minDiscount })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PERCENTS.filter((p) => p >= reference.minDiscount).map((percent) => (
            <Chip
              key={percent}
              disabled={busy}
              onClick={() => void jobAction('prices', { percent }, t('priceApplied'))}
            >
              −{percent}%
            </Chip>
          ))}
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const percent = Number(customPercent);
              if (Number.isInteger(percent) && percent >= 1 && percent <= 95)
                void jobAction('prices', { percent }, t('priceApplied'));
            }}
          >
            <input
              type="number"
              min={1}
              max={95}
              inputMode="numeric"
              aria-label={t('priceCustom')}
              placeholder={t('priceCustom')}
              value={customPercent}
              onChange={(event) => setCustomPercent(event.target.value)}
              className="w-36 rounded-ctl border border-line bg-surface px-3 py-1.5 text-[13px] tabular-nums"
            />
            <Button type="submit" size="sm" variant="ghost" disabled={busy || !customPercent}>
              {t('apply')}
            </Button>
          </form>
        </div>
      </section>

      <section id="publish" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-bold">{t('rowsTitle')}</h2>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void jobAction('selection', { selected: true })}
            >
              {t('selectAll')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void jobAction('selection', { selected: false })}
            >
              {t('selectNone')}
            </Button>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {IMPORT_ROW_FILTERS.map((value) => (
            <Chip key={value} active={filter === value} onClick={() => setFilter(value)}>
              {t(`filters.${value}`)}
              <span className="tabular-nums opacity-70">{filterCount[value]}</span>
            </Chip>
          ))}
        </div>
        {!loading && page.items.length === 0 ? (
          <p className="text-[13px] text-muted">{t('emptyRows')}</p>
        ) : (
          <ul className={cn('grid gap-2', loading && 'opacity-60')}>
            {page.items.map((row) => (
              <ImportRowItem
                key={row.id}
                storeId={storeId}
                jobBase={base}
                row={row}
                reference={reference}
                onChange={onRowChange}
              />
            ))}
          </ul>
        )}
        {page.items.length < page.total && (
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-center"
            disabled={loading}
            onClick={() => void loadRows(filter, page.items.length)}
          >
            {t('more')}
          </Button>
        )}
      </section>

      <div className="sticky bottom-0 z-20 -mx-4 border-t border-line bg-paper/95 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] backdrop-blur md:mx-0 md:rounded-xl md:border md:pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-muted">
            {progress
              ? t('publishing', progress)
              : counts.toPublish === 0
                ? t('nothingToPublish')
                : canPublish
                  ? null
                  : t('draftNote')}
          </p>
          {progress ? (
            <div className="flex items-center gap-3">
              <progress
                className="h-2 w-40 accent-ink"
                value={progress.done}
                max={progress.total}
              />
              <Button size="sm" variant="ghost" onClick={() => (stopRef.current = true)}>
                {t('stop')}
              </Button>
            </div>
          ) : (
            <Button disabled={counts.toPublish === 0 || busy} onClick={() => void publish()}>
              {canPublish
                ? t('publishButton', { count: counts.toPublish })
                : t('draftButton', { count: counts.toPublish })}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function MappingGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <h3 className="text-[13px] font-semibold text-muted">{title}</h3>
      <ul className="grid gap-2 sm:grid-cols-2">{children}</ul>
    </div>
  );
}

function MappingRow({
  value,
  note,
  count,
  children,
}: {
  value: string;
  note?: string;
  count: string;
  children: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1fr_minmax(0,1.2fr)] items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2">
      <div className="grid min-w-0 justify-items-start gap-1">
        <p className="truncate font-semibold">{value}</p>
        {note && <p className="truncate text-[12px] text-muted">{note}</p>}
        <Pill>{count}</Pill>
      </div>
      {children}
    </li>
  );
}
