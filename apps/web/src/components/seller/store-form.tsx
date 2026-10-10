'use client';

import {
  ApiError,
  apiRequest,
  type City,
  NetworkError,
  type StoreDetail,
  WEEKDAYS,
  type Weekday,
} from '@lastsize/contracts';
import { Button, cn, Notice, SelectField, TextAreaField, TextField, useToast } from '@lastsize/ui';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';

type DaySchedule = { open: boolean; from: string; to: string };
type ScheduleState = Record<Weekday, DaySchedule>;

const DEFAULT_SCHEDULE: ScheduleState = {
  mon: { open: true, from: '10:00', to: '20:00' },
  tue: { open: true, from: '10:00', to: '20:00' },
  wed: { open: true, from: '10:00', to: '20:00' },
  thu: { open: true, from: '10:00', to: '20:00' },
  fri: { open: true, from: '10:00', to: '20:00' },
  sat: { open: true, from: '11:00', to: '19:00' },
  sun: { open: false, from: '11:00', to: '19:00' },
};

function scheduleFromStore(store: StoreDetail | null): ScheduleState {
  if (!store) return DEFAULT_SCHEDULE;
  return Object.fromEntries(
    WEEKDAYS.map((day) => {
      const first = store.location.schedule[day]?.[0];
      return [
        day,
        first
          ? { open: true, from: first[0], to: first[1] }
          : { ...DEFAULT_SCHEDULE[day], open: false },
      ];
    }),
  ) as ScheduleState;
}

/**
 * Create or edit the store. One opening interval per day in the form (the API accepts up to three).
 * Validation errors come back as codes and are translated here.
 */
export function StoreForm({ store, cities }: { store: StoreDetail | null; cities: City[] }) {
  const t = useTranslations('store');
  const validation = useTranslations('validation');
  const errors = useTranslations('errors');
  const locale = useLocale() === 'kk' ? 'kk' : 'ru';
  const router = useRouter();
  const toast = useToast();
  const [schedule, setSchedule] = useState<ScheduleState>(() => scheduleFromStore(store));
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const translate = (code: string) =>
    validation.has(code) ? validation(code) : validation('generic');
  const fieldError = (path: string) => fieldErrors[path];
  const scheduleError = Object.entries(fieldErrors).find(([path]) =>
    path.startsWith('location.schedule'),
  )?.[1];

  const setDay = (day: Weekday, patch: Partial<DaySchedule>) =>
    setSchedule((current) => ({ ...current, [day]: { ...current[day], ...patch } }));
  const copyMonday = () =>
    setSchedule((current) => ({
      ...current,
      tue: { ...current.mon },
      wed: { ...current.mon },
      thu: { ...current.mon },
      fri: { ...current.mon },
    }));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? '').trim();
    const optional = (name: string) => text(name) || undefined;
    const body = {
      name: text('name'),
      binIin: text('binIin'),
      legalName: optional('legalName'),
      description: optional('description'),
      instagram: optional('instagram'),
      location: {
        cityId: Number(data.get('cityId')),
        address: text('address'),
        phone: text('phone'),
        pickupEnabled: data.get('pickupEnabled') === 'on',
        deliveryEnabled: data.get('deliveryEnabled') === 'on',
        schedule: Object.fromEntries(
          WEEKDAYS.map((day) => [
            day,
            schedule[day].open ? [[schedule[day].from, schedule[day].to]] : [],
          ]),
        ),
      },
    };

    setPending(true);
    setFormError(null);
    setFieldErrors({});
    try {
      if (store) {
        await apiRequest('PATCH', `/seller/stores/${store.id}`, body);
        toast({ title: t('saved') });
        router.refresh();
      } else {
        await apiRequest('POST', '/seller/stores', body);
        router.replace('/seller/dashboard');
        router.refresh();
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        setFieldErrors(
          Object.fromEntries(
            Object.entries(error.fieldErrors()).map(([path, code]) => [path, translate(code)]),
          ),
        );
        // The form is long: bring the first invalid field into view so the error is not missed.
        requestAnimationFrame(() =>
          formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
        );
      } else if (error instanceof ApiError) {
        setFormError(error.problem?.detail ?? errors('generic'));
      } else {
        setFormError(error instanceof NetworkError ? errors('network') : errors('generic'));
      }
    } finally {
      setPending(false);
    }
  }

  const submitLabel = !store
    ? t('submitCreate')
    : store.status === 'REJECTED'
      ? t('submitResubmit')
      : t('submitEdit');

  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid max-w-2xl gap-8" noValidate>
      <fieldset className="grid gap-4">
        <legend className="mb-3 text-[15px] font-bold">{t('sectionMain')}</legend>
        <TextField
          label={t('name')}
          name="name"
          defaultValue={store?.name}
          hint={t('nameHint')}
          error={fieldError('name')}
          required
          maxLength={80}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label={t('binIin')}
            name="binIin"
            inputMode="numeric"
            defaultValue={store?.binIin}
            hint={t('binIinHint')}
            error={fieldError('binIin')}
            required
            maxLength={14}
          />
          <TextField
            label={t('legalName')}
            name="legalName"
            defaultValue={store?.legalName ?? ''}
            hint={t('legalNameHint')}
            error={fieldError('legalName')}
            maxLength={200}
          />
        </div>
        {store?.status === 'VERIFIED' && <Notice>{t('legalChangeWarning')}</Notice>}
        <TextAreaField
          label={t('description')}
          name="description"
          defaultValue={store?.description ?? ''}
          hint={t('descriptionHint')}
          error={fieldError('description')}
          maxLength={2000}
        />
        <TextField
          label={t('instagram')}
          name="instagram"
          defaultValue={store?.instagram ? `@${store.instagram}` : ''}
          hint={t('instagramHint')}
          error={fieldError('instagram')}
        />
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-3 text-[15px] font-bold">{t('sectionAddress')}</legend>
        <div className="grid gap-4 md:grid-cols-[200px_1fr]">
          <SelectField
            label={t('city')}
            name="cityId"
            defaultValue={String(store?.location.cityId ?? cities[0]?.id ?? '')}
            options={cities.map((city) => ({ value: String(city.id), label: city.name[locale] }))}
            error={fieldError('location.cityId')}
          />
          <TextField
            label={t('address')}
            name="address"
            defaultValue={store?.location.address}
            hint={t('addressHint')}
            error={fieldError('location.address')}
            required
            maxLength={200}
          />
        </div>
        <TextField
          label={t('phone')}
          name="phone"
          type="tel"
          inputMode="tel"
          defaultValue={store?.location.phone}
          hint={t('phoneHint')}
          error={fieldError('location.phone')}
          required
        />
        <label className="flex items-center gap-2 text-[14px]">
          <input
            type="checkbox"
            name="pickupEnabled"
            defaultChecked={store?.location.pickupEnabled ?? true}
            className="size-4 accent-current"
          />
          {t('pickup')}
        </label>
        <label className="flex items-center gap-2 text-[14px]">
          <input
            type="checkbox"
            name="deliveryEnabled"
            defaultChecked={store?.location.deliveryEnabled ?? true}
            className="size-4 accent-current"
          />
          {t('deliveryOption')}
        </label>
        {fieldError('location.deliveryEnabled') && (
          <p className="text-xs text-sale">{fieldError('location.deliveryEnabled')}</p>
        )}
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-3 flex w-full items-center justify-between gap-3 text-[15px] font-bold">
          {t('sectionSchedule')}
        </legend>
        <Button variant="text" size="sm" className="justify-self-start" onClick={copyMonday}>
          {t('copyMonday')}
        </Button>
        <div className="grid gap-2">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 md:grid-cols-[140px_auto_1fr]"
            >
              <span className="text-[14px] font-medium">{t(`days.${day}`)}</span>
              <label className="flex items-center gap-1.5 text-[13px] text-muted">
                <input
                  type="checkbox"
                  checked={!schedule[day].open}
                  onChange={(event) => setDay(day, { open: !event.target.checked })}
                  className="size-4"
                />
                {t('closed')}
              </label>
              <div
                className={cn(
                  'col-span-2 flex items-center gap-2 md:col-span-1',
                  !schedule[day].open && 'opacity-40',
                )}
              >
                <input
                  type="time"
                  aria-label={`${t(`days.${day}`)}: ${t('opens')}`}
                  value={schedule[day].from}
                  disabled={!schedule[day].open}
                  onChange={(event) => setDay(day, { from: event.target.value })}
                  className="rounded-lg border border-line bg-surface px-2 py-1.5 text-[14px] tabular-nums"
                />
                <span aria-hidden>—</span>
                <input
                  type="time"
                  aria-label={`${t(`days.${day}`)}: ${t('closes')}`}
                  value={schedule[day].to}
                  disabled={!schedule[day].open}
                  onChange={(event) => setDay(day, { to: event.target.value })}
                  className="rounded-lg border border-line bg-surface px-2 py-1.5 text-[14px] tabular-nums"
                />
              </div>
            </div>
          ))}
        </div>
        {scheduleError && <p className="text-xs text-sale">{scheduleError}</p>}
      </fieldset>

      {formError && (
        <p role="alert" className="rounded-lg bg-sale-soft px-3 py-2 text-[13px] text-sale">
          {formError}
        </p>
      )}
      <Button type="submit" loading={pending} className="justify-self-start">
        {submitLabel}
      </Button>
    </form>
  );
}
