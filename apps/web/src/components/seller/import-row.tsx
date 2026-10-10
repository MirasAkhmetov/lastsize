'use client';

import {
  ApiError,
  apiRequest,
  apiUpload,
  GENDERS,
  type ImportRow,
  type Media,
  NetworkError,
} from '@lastsize/contracts';
import { discountPercent } from '@lastsize/domain';
import {
  Button,
  cn,
  DiscountBadge,
  formatPrice,
  Pill,
  type PillTone,
  ProductImage,
  SelectField,
  TextField,
  useToast,
} from '@lastsize/ui';
import { useLocale, useTranslations } from 'next-intl';
import { type ChangeEvent, type FormEvent, useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import type { ImportReference } from './import-wizard';

type Gender = (typeof GENDERS)[number];

const TONES: Record<ImportRow['status'], PillTone> = {
  READY: 'ok',
  NEEDS_ATTENTION: 'warn',
  PUBLISHING: 'info',
  PUBLISHED: 'ok',
  FAILED: 'sale',
  SKIPPED: 'muted',
};
const LOCKED: ImportRow['status'][] = ['PUBLISHING', 'PUBLISHED', 'SKIPPED'];

function parseTenge(value: string): number | null {
  const digits = value.replace(/[^\d]/g, '');
  return digits ? Number(digits) * 100 : null;
}
const tengeInput = (tiyn: number | null) => (tiyn ? String(tiyn / 100) : '');

interface Props {
  storeId: string;
  jobBase: string;
  row: ImportRow;
  reference: ImportReference;
  onChange: (row: ImportRow) => void;
}

/** One imported product: a summary line, and an inline editor for whatever needs fixing. */
export function ImportRowItem({ storeId, jobBase, row, reference, onChange }: Props) {
  const t = useTranslations('imports');
  const tp = useTranslations('products');
  const validation = useTranslations('validation');
  const errors = useTranslations('errors');
  const lang = useLocale() === 'kk' ? 'kk' : 'ru';
  const toast = useToast();
  const locked = LOCKED.includes(row.status);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const translate = (code: string) =>
    validation.has(code) ? validation(code) : validation('generic');

  async function patch(body: Record<string, unknown>) {
    setPending(true);
    setFieldErrors({});
    try {
      const updated = await apiRequest<ImportRow>('PATCH', `${jobBase}/rows/${row.id}`, body);
      onChange(updated);
      return true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 422) {
        setFieldErrors(
          Object.fromEntries(
            Object.entries(cause.fieldErrors()).map(([path, code]) => [
              path.split('.')[0]!,
              translate(code),
            ]),
          ),
        );
      } else {
        toast({
          title:
            cause instanceof ApiError
              ? (cause.problem?.detail ?? errors('generic'))
              : cause instanceof NetworkError
                ? errors('network')
                : errors('generic'),
        });
      }
      return false;
    } finally {
      setPending(false);
    }
  }

  const sizesSummary = row.sizes
    .map((size) => `${size.label ?? t('oneSize')} ×${size.quantity}`)
    .join(' · ');

  return (
    <li className="rounded-xl border border-line bg-surface">
      <div className="grid grid-cols-[auto_1fr] gap-3 p-3 md:grid-cols-[auto_1fr_180px_auto] md:items-center">
        <input
          type="checkbox"
          aria-label={t('select')}
          checked={row.selected}
          disabled={locked || pending}
          onChange={(event) => void patch({ selected: event.target.checked })}
          className="mt-1 size-4 accent-ink md:mt-0"
        />
        <div className="min-w-0">
          <p className="truncate font-semibold">{row.title}</p>
          <p className="truncate text-[12.5px] text-muted">
            {[row.brand, row.article, row.sourceCategory].filter(Boolean).join(' · ')}
          </p>
          <p className="truncate text-[12px] text-muted tabular-nums">{sizesSummary}</p>
        </div>
        <div className="col-start-2 flex items-center gap-2 text-[13px] tabular-nums md:col-start-auto">
          {row.salePrice !== null && (
            <span className="font-bold">{formatPrice(row.salePrice)}</span>
          )}
          {row.originalPrice !== null && row.salePrice !== null && (
            <span className="text-muted line-through">{formatPrice(row.originalPrice)}</span>
          )}
          {row.discountPercent !== null && row.discountPercent > 0 && (
            <DiscountBadge percent={row.discountPercent} />
          )}
        </div>
        <div className="col-start-2 flex flex-wrap items-center gap-2 md:col-start-auto md:justify-end">
          <Pill tone={TONES[row.status]}>{t(`statuses.${row.status}`)}</Pill>
          {row.productId ? (
            <Link
              href={`/seller/products/${row.productId}`}
              className="text-[13px] underline underline-offset-4"
            >
              {t('openProduct')}
            </Link>
          ) : (
            !locked && (
              <Button size="sm" variant="ghost" onClick={() => setOpen((value) => !value)}>
                {open ? t('collapse') : t('edit')}
              </Button>
            )
          )}
        </div>
        {row.issues.length > 0 && (
          <ul className="col-start-2 flex flex-wrap gap-1.5 md:col-span-3">
            {row.issues.map((code) => (
              <li key={code} className="rounded-md bg-warn-soft px-2 py-0.5 text-[12px] text-warn">
                {validation.has(code) ? validation(code) : code}
              </li>
            ))}
          </ul>
        )}
      </div>
      {open && !locked && (
        <RowEditor
          storeId={storeId}
          row={row}
          reference={reference}
          lang={lang}
          pending={pending}
          fieldErrors={fieldErrors}
          onSave={async (body) => {
            if (await patch(body)) {
              toast({ title: t('saved') });
              setOpen(false);
            }
          }}
          labels={{ t, tp, translate }}
        />
      )}
    </li>
  );
}

function RowEditor({
  storeId,
  row,
  reference,
  lang,
  pending,
  fieldErrors,
  onSave,
  labels: { t, tp, translate },
}: {
  storeId: string;
  row: ImportRow;
  reference: ImportReference;
  lang: 'ru' | 'kk';
  pending: boolean;
  fieldErrors: Record<string, string>;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  labels: {
    t: ReturnType<typeof useTranslations<'imports'>>;
    tp: ReturnType<typeof useTranslations<'products'>>;
    translate: (code: string) => string;
  };
}) {
  const [categoryId, setCategoryId] = useState<number | null>(row.categoryId);
  const [gender, setGender] = useState<Gender | null>(row.gender);
  const [sizes, setSizes] = useState(
    row.sizes.map((size) => ({ sizeValueId: size.sizeValueId, quantity: size.quantity })),
  );
  const [images, setImages] = useState<Media[]>(row.images);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [originalPrice, setOriginalPrice] = useState(tengeInput(row.originalPrice));
  const [salePrice, setSalePrice] = useState(tengeInput(row.salePrice));

  // Same rule as the API: kids' clothing is sized by height, the rest by category.
  const chart = useMemo(() => {
    for (const root of reference.categories) {
      const leaf = root.children.find((child) => child.id === categoryId);
      if (!leaf) continue;
      const code = root.slug === 'clothing' && gender === 'KIDS' ? 'KIDS_HEIGHT' : leaf.sizeChart;
      return code === null ? null : (reference.sizeCharts.find((c) => c.code === code) ?? null);
    }
    return undefined;
  }, [categoryId, gender, reference]);

  const original = parseTenge(originalPrice);
  const sale = parseTenge(salePrice);
  const discount =
    original && sale
      ? discountPercent({
          originalPrice: original,
          salePrice: sale,
          externalPrice: row.externalPrice,
        })
      : null;

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])].slice(0, 10 - images.length);
    event.target.value = '';
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of files) {
        const media = await apiUpload<Media>(`/seller/stores/${storeId}/media`, file, file.name);
        setImages((current) => [...current, media]);
      }
    } catch (cause) {
      const code = cause instanceof ApiError ? Object.values(cause.fieldErrors())[0] : undefined;
      setUploadError(code ? translate(code) : translate('generic'));
    } finally {
      setUploading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? '').trim();
    const chartIds = new Set(chart?.values.map((v) => v.id) ?? []);
    const body: Record<string, unknown> = {
      title: text('title'),
      sizes: sizes.map((size) => ({
        // A size from another chart (the category just changed) is matched again by the API.
        sizeValueId:
          size.sizeValueId !== null && chartIds.has(size.sizeValueId) ? size.sizeValueId : null,
        quantity: size.quantity,
      })),
      mediaIds: images.map((image) => image.id),
    };
    if (text('brand')) body.brand = text('brand');
    if (categoryId) body.categoryId = categoryId;
    if (gender) body.gender = gender;
    if (Number(data.get('colorId'))) body.colorId = Number(data.get('colorId'));
    if (original) body.originalPrice = original;
    if (sale) body.salePrice = sale;
    void onSave(body);
  }

  return (
    <form onSubmit={submit} className="grid gap-4 border-t border-line p-4" noValidate>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label={tp('titleLabel')}
          name="title"
          defaultValue={row.title}
          maxLength={120}
          error={fieldErrors.title}
        />
        <TextField
          label={tp('brand')}
          name="brand"
          defaultValue={row.brand ?? ''}
          maxLength={60}
          error={fieldErrors.brand}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <SelectField
          label={tp('category')}
          value={categoryId ? String(categoryId) : ''}
          onChange={(event) => setCategoryId(Number(event.target.value) || null)}
          error={fieldErrors.categoryId}
          options={[
            { value: '', label: tp('chooseCategory') },
            ...reference.categories.flatMap((root) =>
              root.children.map((child) => ({
                value: String(child.id),
                label: child.name[lang],
                group: root.name[lang],
              })),
            ),
          ]}
        />
        <SelectField
          label={tp('gender')}
          value={gender ?? ''}
          onChange={(event) => setGender((event.target.value || null) as Gender | null)}
          options={[
            { value: '', label: t('mapChoose') },
            ...GENDERS.map((value) => ({ value, label: tp(`genders.${value}`) })),
          ]}
        />
        <SelectField
          label={tp('color')}
          name="colorId"
          defaultValue={row.colorId ? String(row.colorId) : ''}
          error={fieldErrors.colorId}
          options={[
            { value: '', label: t('mapChoose') },
            ...reference.colors.map((color) => ({
              value: String(color.id),
              label: color.name[lang],
            })),
          ]}
        />
      </div>

      <fieldset className="grid gap-2" data-error={fieldErrors.sizes ? 'true' : undefined}>
        <legend className="mb-1 text-[13px] font-semibold">{tp('sectionSizes')}</legend>
        <div className="grid grid-cols-[1fr_1fr_90px] gap-2 text-[12px] text-muted">
          <span>{t('sizeFrom')}</span>
          <span>{t('sizeOurs')}</span>
          <span>{t('quantity')}</span>
        </div>
        {row.sizes.map((size, index) => (
          <div key={index} className="grid grid-cols-[1fr_1fr_90px] items-center gap-2">
            <span className="text-[13px] tabular-nums">{size.label ?? t('oneSize')}</span>
            {chart ? (
              <select
                aria-label={t('sizeOurs')}
                value={sizes[index]!.sizeValueId ?? ''}
                onChange={(event) =>
                  setSizes((current) =>
                    current.map((item, i) =>
                      i === index
                        ? { ...item, sizeValueId: Number(event.target.value) || null }
                        : item,
                    ),
                  )
                }
                className="rounded-ctl border border-line bg-surface px-2 py-1.5 text-[13px]"
              >
                <option value="">{t('mapChoose')}</option>
                {chart.values.map((value) => (
                  <option key={value.id} value={value.id}>
                    {value.code}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[13px] text-muted">
                {chart === null ? t('oneSize') : t('noSize')}
              </span>
            )}
            <input
              type="number"
              min={0}
              max={9999}
              inputMode="numeric"
              aria-label={t('quantity')}
              value={sizes[index]!.quantity}
              onChange={(event) =>
                setSizes((current) =>
                  current.map((item, i) =>
                    i === index
                      ? {
                          ...item,
                          quantity: Math.min(9999, Math.max(0, Number(event.target.value) || 0)),
                        }
                      : item,
                  ),
                )
              }
              className="rounded-ctl border border-line bg-surface px-2 py-1.5 text-[13px] tabular-nums"
            />
          </div>
        ))}
        {fieldErrors.sizes && <p className="text-xs text-sale">{fieldErrors.sizes}</p>}
      </fieldset>

      <div className="grid gap-4 md:grid-cols-3 md:items-end">
        <TextField
          label={t('priceBefore')}
          inputMode="numeric"
          value={originalPrice}
          onChange={(event) => setOriginalPrice(event.target.value)}
          error={fieldErrors.originalPrice}
        />
        <TextField
          label={t('priceSale')}
          inputMode="numeric"
          value={salePrice}
          onChange={(event) => setSalePrice(event.target.value)}
          error={fieldErrors.salePrice}
        />
        <div className="grid gap-1 pb-2 text-[13px]">
          {discount !== null && discount > 0 && <DiscountBadge percent={discount} />}
          {row.externalPrice !== null && (
            <span className="text-muted">
              {t('marketplacePrice', { price: formatPrice(row.externalPrice) })}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-2" data-error={fieldErrors.mediaIds ? 'true' : undefined}>
        <span className="text-[13px] font-semibold">{tp('sectionPhotos')}</span>
        {images.length === 0 && (
          <p className="text-[12.5px] text-muted">
            {row.photoCount > 0 ? t('photosFromSource', { count: row.photoCount }) : t('noPhotos')}
          </p>
        )}
        <ul className="flex flex-wrap gap-2">
          {images.map((image) => (
            <li key={image.id} className="relative w-16">
              <div className="aspect-[3/4] overflow-hidden rounded-img bg-photo-1">
                <ProductImage url={image.url} alt="" sizes="64px" />
              </div>
              <button
                type="button"
                aria-label={tp('removePhoto')}
                onClick={() => setImages((current) => current.filter((x) => x.id !== image.id))}
                className="absolute top-0.5 right-0.5 rounded bg-ink/80 px-1 text-[11px] text-paper"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        {images.length < 10 && (
          <label
            className={cn(
              'cursor-pointer justify-self-start rounded-ctl border border-line px-3 py-[7px] text-[13px] font-semibold hover:bg-soft',
              uploading && 'pointer-events-none opacity-50',
            )}
          >
            {uploading ? tp('uploading') : `+ ${tp('addPhoto')}`}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
              multiple
              onChange={onFiles}
              className="sr-only"
            />
          </label>
        )}
        {(uploadError || fieldErrors.mediaIds) && (
          <p className="text-xs text-sale">{uploadError ?? fieldErrors.mediaIds}</p>
        )}
      </div>

      <Button
        type="submit"
        size="sm"
        className="justify-self-start"
        disabled={pending || uploading}
      >
        {t('save')}
      </Button>
    </form>
  );
}
