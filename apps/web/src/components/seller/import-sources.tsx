'use client';

import {
  ApiError,
  apiRequest,
  apiUpload,
  type ImportJob,
  type Integration,
  NetworkError,
} from '@lastsize/contracts';
import { Button, Notice, TextField, useToast } from '@lastsize/ui';
import { useTranslations } from 'next-intl';
import { type ChangeEvent, type FormEvent, type ReactNode, useState } from 'react';
import { useRouter } from '@/i18n/navigation';

interface Props {
  storeId: string;
  integrations: Integration[];
}

function Card({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <section className="grid content-start gap-3 rounded-2xl border border-line bg-surface p-5">
      <h2 className="font-display text-lg font-bold">{title}</h2>
      <p className="text-[13px] text-muted">{text}</p>
      {children}
    </section>
  );
}

/** Three ways in: Wildberries (token), Kaspi (price-list URL), a spreadsheet file. */
export function ImportSources({ storeId, integrations }: Props) {
  const t = useTranslations('imports');
  const validation = useTranslations('validation');
  const errors = useTranslations('errors');
  const router = useRouter();
  const toast = useToast();
  const base = `/seller/stores/${storeId}`;
  const wb = integrations.find((i) => i.provider === 'WILDBERRIES');
  const kaspi = integrations.find((i) => i.provider === 'KASPI_XML');

  const [pending, setPending] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const translate = (code: string) =>
    validation.has(code) ? validation(code) : validation('generic');

  function showError(error: unknown) {
    if (error instanceof ApiError && error.status === 422) {
      setFieldErrors(
        Object.fromEntries(
          Object.entries(error.fieldErrors()).map(([path, code]) => [path, translate(code)]),
        ),
      );
    } else if (error instanceof ApiError) {
      setFormError(error.problem?.detail ?? errors('generic'));
    } else {
      setFormError(error instanceof NetworkError ? errors('network') : errors('generic'));
    }
  }

  async function run(key: string, action: () => Promise<void>) {
    setPending(key);
    setFieldErrors({});
    setFormError(null);
    try {
      await action();
    } catch (error) {
      showError(error);
    } finally {
      setPending(null);
    }
  }

  const openJob = (job: ImportJob) => router.push(`/seller/import/${job.id}`);

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const token = String(new FormData(form).get('token') ?? '').trim();
    void run('connect', async () => {
      await apiRequest('POST', `${base}/integrations/wildberries`, { token });
      form.reset();
      router.refresh();
    });
  }

  const loadWildberries = () =>
    run('wb', async () =>
      openJob(await apiRequest<ImportJob>('POST', `${base}/imports`, { source: 'WILDBERRIES' })),
    );

  const disconnect = () => {
    if (!window.confirm(t('wbDisconnectConfirm'))) return;
    void run('disconnect', async () => {
      await apiRequest('DELETE', `${base}/integrations/WILDBERRIES`);
      toast({ title: t('wbDisconnected') });
      router.refresh();
    });
  };

  function loadKaspi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = String(new FormData(event.currentTarget).get('url') ?? '').trim();
    void run('kaspi', async () =>
      openJob(await apiRequest<ImportJob>('POST', `${base}/imports`, { source: 'KASPI_XML', url })),
    );
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void run('file', async () =>
      openJob(await apiUpload<ImportJob>(`${base}/imports/file`, file, file.name)),
    );
  }

  return (
    <div className="grid gap-4">
      {formError && <Notice>{formError}</Notice>}
      {pending && pending !== 'connect' && pending !== 'disconnect' && (
        <Notice tone="info">{t('loading')}</Notice>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('wbTitle')} text={t('wbText')}>
          {wb ? (
            <div className="grid gap-3">
              <p className="text-[13px] font-semibold text-ok">
                {t('wbConnected', { hint: wb.tokenHint ?? '' })}
              </p>
              {wb.lastError && (
                <Notice>
                  {t('wbLastError', {
                    error: validation.has(wb.lastError) ? validation(wb.lastError) : wb.lastError,
                  })}
                </Notice>
              )}
              {fieldErrors.source && <p className="text-xs text-sale">{fieldErrors.source}</p>}
              {fieldErrors.token && <p className="text-xs text-sale">{fieldErrors.token}</p>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={loadWildberries} disabled={pending !== null}>
                  {t('wbLoad')}
                </Button>
                <Button size="sm" variant="ghost" onClick={disconnect} disabled={pending !== null}>
                  {t('wbDisconnect')}
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={connect} className="grid gap-3" noValidate>
              <details className="rounded-lg bg-soft px-3 py-2 text-[13px]">
                <summary className="cursor-pointer font-semibold">{t('wbHowTo')}</summary>
                <ol className="mt-2 grid list-decimal gap-1 pl-5 text-muted">
                  <li>{t('wbStep1')}</li>
                  <li>{t('wbStep2')}</li>
                  <li>{t('wbStep3')}</li>
                  <li>{t('wbStep4')}</li>
                </ol>
              </details>
              <TextField
                label={t('wbTokenLabel')}
                name="token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                hint={t('wbTokenHint')}
                error={fieldErrors.token}
                required
              />
              <Button type="submit" size="sm" disabled={pending !== null}>
                {t('wbConnect')}
              </Button>
            </form>
          )}
        </Card>

        <Card title={t('kaspiTitle')} text={t('kaspiText')}>
          <form onSubmit={loadKaspi} className="grid gap-3" noValidate>
            <TextField
              label={t('kaspiUrlLabel')}
              name="url"
              type="url"
              inputMode="url"
              placeholder="https://"
              defaultValue={kaspi?.kaspiUrl ?? ''}
              hint={t('kaspiUrlHint')}
              error={fieldErrors.url}
              required
            />
            <Button type="submit" size="sm" disabled={pending !== null}>
              {t('kaspiLoad')}
            </Button>
          </form>
        </Card>

        <Card title={t('fileTitle')} text={t('fileText')}>
          <div className="grid gap-3">
            <input
              id="import-file"
              type="file"
              accept=".xlsx,.csv,.xml,text/csv,application/xml,text/xml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={onFile}
              disabled={pending !== null}
              className="sr-only"
            />
            <label
              htmlFor="import-file"
              className="cursor-pointer justify-self-start rounded-ctl bg-ink px-3 py-[7px] text-[13px] font-semibold text-paper hover:opacity-90"
            >
              {t('fileChoose')}
            </label>
            <p className="text-[12px] text-muted">{t('fileHint')}</p>
            {fieldErrors.file && <p className="text-xs text-sale">{fieldErrors.file}</p>}
            <a
              href="/templates/lastsize-import.csv"
              download
              className="justify-self-start text-[13px] underline underline-offset-4"
            >
              {t('fileTemplate')}
            </a>
          </div>
        </Card>
      </div>
    </div>
  );
}
