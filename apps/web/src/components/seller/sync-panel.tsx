'use client';

import {
  ApiError,
  apiRequest,
  type Integration,
  NetworkError,
  type SyncRun,
  type Warehouse,
} from '@lastsize/contracts';
import { Button, Notice, Pill, type PillTone, useToast } from '@lastsize/ui';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

const TONES: Record<SyncRun['status'], PillTone> = {
  RUNNING: 'info',
  SUCCESS: 'ok',
  PARTIAL: 'warn',
  FAILED: 'sale',
};
const SHOWN_CHANGES = 5;

/** Stock sync settings and log for each connected marketplace. */
export function SyncPanel({
  storeId,
  integrations: initial,
}: {
  storeId: string;
  integrations: Integration[];
}) {
  const t = useTranslations('sync');
  const [integrations, setIntegrations] = useState(initial);
  useEffect(() => setIntegrations(initial), [initial]);

  return (
    <section className="grid gap-3">
      <div className="grid gap-1">
        <h2 className="text-[15px] font-bold">{t('title')}</h2>
        <p className="text-[13px] text-muted">{t('lead')}</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {integrations.map((integration) => (
          <IntegrationSync
            key={integration.provider}
            storeId={storeId}
            integration={integration}
            onChange={setIntegrations}
          />
        ))}
      </div>
    </section>
  );
}

function IntegrationSync({
  storeId,
  integration,
  onChange,
}: {
  storeId: string;
  integration: Integration;
  onChange: (list: Integration[]) => void;
}) {
  const t = useTranslations('sync');
  const ti = useTranslations('imports');
  const validation = useTranslations('validation');
  const errors = useTranslations('errors');
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const toast = useToast();
  const base = `/seller/stores/${storeId}/integrations`;
  const isWb = integration.provider === 'WILDBERRIES';
  const [warehouses, setWarehouses] = useState<Warehouse[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<SyncRun[] | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const code = (value: string) => (validation.has(value) ? validation(value) : value);
  const describe = useCallback(
    (cause: unknown) => {
      if (cause instanceof ApiError) {
        const field = Object.values(cause.fieldErrors())[0];
        if (field) return validation.has(field) ? validation(field) : validation('generic');
        return cause.problem?.detail ?? errors('generic');
      }
      return cause instanceof NetworkError ? errors('network') : errors('generic');
    },
    [errors, validation],
  );

  useEffect(() => {
    if (!isWb || integration.linkedCount === 0) return;
    apiRequest<Warehouse[]>('GET', `${base}/WILDBERRIES/warehouses`)
      .then(setWarehouses)
      .catch((cause: unknown) => setError(describe(cause)));
  }, [base, describe, integration.linkedCount, isWb]);

  const loadRuns = useCallback(async () => {
    try {
      setRuns(await apiRequest<SyncRun[]>('GET', `${base}/${integration.provider}/runs`));
    } catch (cause) {
      setError(describe(cause));
    }
  }, [base, describe, integration.provider]);

  useEffect(() => {
    if (logOpen) void loadRuns();
  }, [logOpen, loadRuns]);

  async function save(patch: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      onChange(await apiRequest<Integration[]>('PATCH', `${base}/${integration.provider}`, patch));
      toast({ title: t('saved') });
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setPending(false);
    }
  }

  async function syncNow() {
    setPending(true);
    setError(null);
    try {
      await apiRequest('POST', `${base}/${integration.provider}/sync`);
      toast({ title: t('queued') });
      // The worker usually finishes within seconds; refresh the status and the log then.
      setTimeout(() => {
        void apiRequest<Integration[]>('GET', base).then(onChange);
        if (logOpen) void loadRuns();
      }, 5000);
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setPending(false);
    }
  }

  const lastSync = integration.lastSyncAt
    ? t('lastSync', {
        time: format.relativeTime(
          // The page clock may lag a sync that just finished: never show "in N seconds".
          new Date(Math.min(Date.parse(integration.lastSyncAt), now.getTime())),
          now,
        ),
      })
    : t('never');

  return (
    <div className="grid content-start gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-bold">
          {ti(`sources.${integration.provider}`)}
        </h3>
        <span className="text-[12.5px] text-muted">
          {t('linked', { count: integration.linkedCount })}
        </span>
      </div>

      {integration.linkedCount === 0 ? (
        <p className="text-[13px] text-muted">{t('empty')}</p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-[13.5px] font-semibold">
            <input
              type="checkbox"
              className="size-4 accent-ink"
              checked={integration.syncEnabled}
              disabled={pending}
              onChange={(event) => void save({ syncEnabled: event.target.checked })}
            />
            {t('enabled')}
          </label>

          {integration.syncEnabled && (
            <>
              <p className="text-[12.5px] text-muted">
                {integration.syncing ? t('running') : lastSync}
              </p>
              {integration.lastError && <Notice>{code(integration.lastError)}</Notice>}

              {isWb ? (
                <div className="grid gap-3">
                  <label className="grid gap-1.5 text-[12.5px] font-semibold">
                    {t('warehouse')}
                    <select
                      value={integration.warehouseId ?? ''}
                      disabled={pending || warehouses === null}
                      onChange={(event) => {
                        const id = Number(event.target.value) || null;
                        void save(
                          id === null
                            ? { warehouseId: null, pushStock: false }
                            : { warehouseId: id },
                        );
                      }}
                      className="rounded-ctl border border-line bg-surface px-3 py-2 text-[14px] font-normal"
                    >
                      <option value="">{t('warehouseAll')}</option>
                      {(warehouses ?? []).map((warehouse) => (
                        <option key={warehouse.id} value={warehouse.id}>
                          {warehouse.name}
                        </option>
                      ))}
                    </select>
                    <span className="font-normal text-muted">{t('warehouseHint')}</span>
                  </label>
                  <label className="flex items-start gap-2 text-[13.5px]">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-ink"
                      checked={integration.pushStock}
                      disabled={pending || integration.warehouseId === null}
                      onChange={(event) => void save({ pushStock: event.target.checked })}
                    />
                    <span className="grid gap-0.5">
                      <span className="font-semibold">{t('push')}</span>
                      <span className="text-[12.5px] text-muted">{t('pushHint')}</span>
                    </span>
                  </label>
                </div>
              ) : (
                <p className="text-[12.5px] text-muted">{t('kaspiHint')}</p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending || integration.syncing}
                  onClick={() => void syncNow()}
                >
                  {t('syncNow')}
                </Button>
                <Button size="sm" variant="text" onClick={() => setLogOpen((open) => !open)}>
                  {logOpen ? t('close') : t('open')}
                </Button>
              </div>
            </>
          )}
          {error && <p className="text-xs text-sale">{error}</p>}

          {logOpen && (
            <div className="grid gap-2 border-t border-line pt-3">
              <h4 className="text-[13px] font-semibold">{t('logTitle')}</h4>
              {runs === null ? null : runs.length === 0 ? (
                <p className="text-[12.5px] text-muted">{t('logEmpty')}</p>
              ) : (
                <ul className="grid gap-2">
                  {runs.map((run) => (
                    <li
                      key={run.id}
                      className="grid gap-1 rounded-lg bg-soft px-3 py-2 text-[12.5px]"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill tone={TONES[run.status]}>{t(`statuses.${run.status}`)}</Pill>
                        <time dateTime={run.startedAt} className="text-muted">
                          {format.dateTime(new Date(run.startedAt), {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                        <span className="text-muted">· {t(`triggers.${run.trigger}`)}</span>
                      </div>
                      <p className="tabular-nums">
                        {t('summary', { pulled: run.pulled, pushed: run.pushed })}
                      </p>
                      {run.error && <p className="text-warn">{code(run.error)}</p>}
                      {run.changes.length > 0 && (
                        <ul className="grid gap-0.5 text-muted">
                          {run.changes.slice(0, SHOWN_CHANGES).map((change, index) => (
                            <li key={index}>
                              <span className="text-ink">
                                {change.title}
                                {change.size ? `, ${change.size}` : ''}
                              </span>{' '}
                              — {t(`kinds.${change.kind}`)}:{' '}
                              <span className="tabular-nums">
                                {t('change', {
                                  from:
                                    change.kind === 'price' && change.from !== null
                                      ? format.number(change.from / 100)
                                      : String(change.from ?? '—'),
                                  to:
                                    change.kind === 'price' && change.to !== null
                                      ? format.number(change.to / 100)
                                      : String(change.to ?? '—'),
                                })}
                              </span>
                            </li>
                          ))}
                          {run.changes.length > SHOWN_CHANGES && (
                            <li>
                              {t('moreChanges', { count: run.changes.length - SHOWN_CHANGES })}
                            </li>
                          )}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
