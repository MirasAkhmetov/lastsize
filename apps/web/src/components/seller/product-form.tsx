'use client';

import {
  ApiError,
  apiRequest,
  apiUpload,
  type Category,
  type Color,
  GENDERS,
  type Media,
  NetworkError,
  type SellerProduct,
  type SizeChart,
} from '@lastsize/contracts';
import { discountPercent } from '@lastsize/domain';
import {
  Button,
  cn,
  DiscountBadge,
  formatPrice,
  Notice,
  ProductImage,
  SelectField,
  TextAreaField,
  TextField,
  useToast,
} from '@lastsize/ui';
import { useLocale, useTranslations } from 'next-intl';
import { type ChangeEvent, type FormEvent, useMemo, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';

type Gender = (typeof GENDERS)[number];

interface Props {
  storeId: string;
  product: SellerProduct | null;
  categories: Category[];
  sizeCharts: SizeChart[];
  colors: Color[];
  minDiscount: number;
  canPublish: boolean;
}

/** "59 990" or "59990 ₸" → 5_999_000 tiyn; empty or invalid → null. */
function parseTenge(value: string): number | null {
  const digits = value.replace(/[^\d]/g, '');
  return digits ? Number(digits) * 100 : null;
}
const tengeInput = (tiyn: number | undefined) => (tiyn ? String(tiyn / 100) : '');

export function ProductForm({
  storeId,
  product,
  categories,
  sizeCharts,
  colors,
  minDiscount,
  canPublish,
}: Props) {
  const t = useTranslations('products');
  const validation = useTranslations('validation');
  const errors = useTranslations('errors');
  const lang = useLocale() === 'kk' ? 'kk' : 'ru';
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const base = `/seller/stores/${storeId}/products`;

  const editable = !product || (product.status !== 'REMOVED' && product.status !== 'ARCHIVED');
  const [images, setImages] = useState<Media[]>(product?.images ?? []);
  const [uploading, setUploading] = useState(0);
  const [categoryId, setCategoryId] = useState<number | null>(product?.categoryId ?? null);
  const [gender, setGender] = useState<Gender>(product?.gender ?? 'WOMEN');
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      (product?.variants ?? []).map((v) => [String(v.sizeValueId ?? 'one'), v.quantity]),
    ),
  );
  const [originalPrice, setOriginalPrice] = useState(tengeInput(product?.originalPrice));
  const [salePrice, setSalePrice] = useState(tengeInput(product?.salePrice));
  const [pending, setPending] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const translate = (code: string) =>
    validation.has(code) ? validation(code) : validation('generic');

  // Which size system applies: kids' clothing is sized by height, everything else by its category.
  const { chart, oneSize } = useMemo(() => {
    for (const root of categories) {
      const leaf = root.children.find((child) => child.id === categoryId);
      if (!leaf) continue;
      const code = root.slug === 'clothing' && gender === 'KIDS' ? 'KIDS_HEIGHT' : leaf.sizeChart;
      return { chart: sizeCharts.find((c) => c.code === code) ?? null, oneSize: code === null };
    }
    return { chart: null, oneSize: false };
  }, [categories, categoryId, gender, sizeCharts]);

  const prices = {
    originalPrice: parseTenge(originalPrice) ?? 0,
    salePrice: parseTenge(salePrice) ?? 0,
  };
  const discount =
    prices.originalPrice && prices.salePrice
      ? discountPercent({ ...prices, referencePrice: product?.referencePrice })
      : null;

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])].slice(0, 10 - images.length);
    event.target.value = '';
    setFieldErrors((current) => ({ ...current, mediaIds: '' }));
    for (const file of files) {
      setUploading((n) => n + 1);
      try {
        const media = await apiUpload<Media>(`/seller/stores/${storeId}/media`, file, file.name);
        setImages((current) => [...current, media]);
      } catch (error) {
        const code = error instanceof ApiError ? Object.values(error.fieldErrors())[0] : undefined;
        const message =
          error instanceof ApiError && error.status === 413
            ? (error.problem?.detail ?? errors('generic'))
            : code
              ? translate(code)
              : error instanceof NetworkError
                ? errors('network')
                : errors('generic');
        setFieldErrors((current) => ({ ...current, mediaIds: `${file.name}: ${message}` }));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  const moveImage = (index: number, delta: number) =>
    setImages((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item!);
      return next;
    });

  function collect(form: HTMLFormElement) {
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? '').trim();
    const variants = oneSize
      ? [{ sizeValueId: null, quantity: quantities.one ?? 0 }]
      : (chart?.values ?? [])
          .filter((value) => quantities[String(value.id)] !== undefined)
          .map((value) => ({ sizeValueId: value.id, quantity: quantities[String(value.id)] ?? 0 }));
    return {
      title: text('title'),
      brand: text('brand'),
      categoryId: categoryId ?? 0,
      gender,
      colorId: Number(data.get('colorId')),
      description: text('description'),
      composition: text('composition'),
      article: text('article'),
      mediaIds: images.map((image) => image.id),
      originalPrice: parseTenge(originalPrice) ?? 0,
      salePrice: parseTenge(salePrice) ?? 0,
      variants,
    };
  }

  function showError(error: unknown) {
    if (error instanceof ApiError && error.status === 422) {
      const translated = Object.fromEntries(
        Object.entries(error.fieldErrors()).map(([path, code]) => [
          path.split('.')[0]!,
          translate(code),
        ]),
      );
      setFieldErrors(translated);
      if (translated.publish) setFormError(translated.publish);
      requestAnimationFrame(() =>
        formRef.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"], [data-error="true"]')
          ?.scrollIntoView({ block: 'center' }),
      );
    } else if (error instanceof ApiError) {
      setFormError(error.problem?.detail ?? errors('generic'));
    } else {
      setFormError(error instanceof NetworkError ? errors('network') : errors('generic'));
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const intent =
      ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? 'save';
    const body = collect(event.currentTarget);
    setPending(intent);
    setFormError(null);
    setFieldErrors({});
    try {
      if (!product) {
        const created = await apiRequest<SellerProduct>('POST', base, {
          ...body,
          publish: intent === 'publish',
        });
        toast({ title: intent === 'publish' ? t('published') : t('saved') });
        router.replace(`/seller/products/${created.id}`);
      } else {
        await apiRequest('PATCH', `${base}/${product.id}`, body);
        if (intent === 'publish')
          await apiRequest('POST', `${base}/${product.id}/status`, { action: 'publish' });
        toast({ title: intent === 'publish' ? t('published') : t('saved') });
      }
      router.refresh();
    } catch (error) {
      showError(error);
    } finally {
      setPending(null);
    }
  }

  async function changeStatus(action: 'hide' | 'archive') {
    if (!product) return;
    setPending(action);
    try {
      await apiRequest('POST', `${base}/${product.id}/status`, { action });
      toast({ title: action === 'hide' ? t('hidden') : t('archived') });
      router.refresh();
    } catch (error) {
      showError(error);
    } finally {
      setPending(null);
    }
  }

  const isPublic = product?.status === 'ACTIVE' || product?.status === 'FLAGGED';

  return (
    <form ref={formRef} onSubmit={submit} className="grid max-w-3xl gap-8" noValidate>
      {!editable && <Notice>{t('readOnly')}</Notice>}
      <fieldset disabled={!editable} className="contents">
        <section className="grid gap-3" data-error={fieldErrors.mediaIds ? 'true' : undefined}>
          <h2 className="text-[15px] font-bold">{t('sectionPhotos')}</h2>
          <p className="text-[13px] text-muted">{t('photosHint')}</p>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {images.map((image, index) => (
              <li key={image.id} className="relative grid gap-1">
                <div className="aspect-[3/4] overflow-hidden rounded-img bg-photo-1">
                  <ProductImage url={image.url} alt="" sizes="160px" />
                </div>
                {index === 0 && (
                  <span className="absolute top-1 left-1 rounded bg-ink px-1.5 text-[10px] text-paper">
                    {t('cover')}
                  </span>
                )}
                <div className="flex justify-between text-[13px]">
                  <button
                    type="button"
                    aria-label={t('moveLeft')}
                    disabled={index === 0}
                    onClick={() => moveImage(index, -1)}
                    className="px-1 disabled:opacity-30"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    aria-label={t('removePhoto')}
                    onClick={() => setImages((c) => c.filter((x) => x.id !== image.id))}
                    className="px-1 text-sale"
                  >
                    ✕
                  </button>
                  <button
                    type="button"
                    aria-label={t('moveRight')}
                    disabled={index === images.length - 1}
                    onClick={() => moveImage(index, 1)}
                    className="px-1 disabled:opacity-30"
                  >
                    →
                  </button>
                </div>
              </li>
            ))}
            {Array.from({ length: uploading }, (_, index) => (
              <li
                key={`uploading-${index}`}
                className="grid aspect-[3/4] place-items-center rounded-img bg-soft text-[12px] text-muted"
              >
                {t('uploading')}
              </li>
            ))}
          </ul>
          {images.length + uploading < 10 && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
                multiple
                onChange={onFiles}
                className="sr-only"
                id="product-photos"
              />
              <label
                htmlFor="product-photos"
                className="cursor-pointer justify-self-start rounded-ctl border border-line px-3 py-[7px] text-[13px] font-semibold hover:bg-soft"
              >
                + {t('addPhoto')}
              </label>
            </>
          )}
          {fieldErrors.mediaIds && <p className="text-xs text-sale">{fieldErrors.mediaIds}</p>}
        </section>

        <section className="grid gap-4">
          <h2 className="text-[15px] font-bold">{t('sectionMain')}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label={t('titleLabel')}
              name="title"
              defaultValue={product?.title}
              hint={t('titleHint')}
              error={fieldErrors.title}
              maxLength={120}
              required
            />
            <TextField
              label={t('brand')}
              name="brand"
              defaultValue={product?.brand ?? ''}
              error={fieldErrors.brand}
              maxLength={60}
              required
            />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <SelectField
              label={t('category')}
              value={categoryId ? String(categoryId) : ''}
              onChange={(event) => setCategoryId(Number(event.target.value) || null)}
              error={fieldErrors.categoryId}
              options={[
                { value: '', label: t('chooseCategory') },
                ...categories.flatMap((root) =>
                  root.children.map((child) => ({
                    value: String(child.id),
                    label: child.name[lang],
                    group: root.name[lang],
                  })),
                ),
              ]}
            />
            <SelectField
              label={t('gender')}
              value={gender}
              onChange={(event) => setGender(event.target.value as Gender)}
              options={GENDERS.map((value) => ({ value, label: t(`genders.${value}`) }))}
            />
            <SelectField
              label={t('color')}
              name="colorId"
              defaultValue={String(product?.colorId ?? colors[0]?.id ?? '')}
              error={fieldErrors.colorId}
              options={colors.map((color) => ({
                value: String(color.id),
                label: color.name[lang],
              }))}
            />
          </div>
          <TextField
            label={t('article')}
            name="article"
            defaultValue={product?.article ?? ''}
            hint={t('articleHint')}
            error={fieldErrors.article}
            maxLength={60}
          />
          <TextAreaField
            label={t('description')}
            name="description"
            defaultValue={product?.description ?? ''}
            maxLength={4000}
            error={fieldErrors.description}
          />
          <TextField
            label={t('composition')}
            name="composition"
            defaultValue={product?.composition ?? ''}
            hint={t('compositionHint')}
            maxLength={500}
            error={fieldErrors.composition}
          />
        </section>

        <section className="grid gap-3" data-error={fieldErrors.variants ? 'true' : undefined}>
          <h2 className="text-[15px] font-bold">{t('sectionSizes')}</h2>
          {!categoryId ? (
            <p className="text-[13px] text-muted">{t('chooseCategoryFirst')}</p>
          ) : oneSize ? (
            <label className="grid max-w-40 gap-1.5 text-[12.5px] font-semibold">
              {t('oneSize')}
              <input
                type="number"
                min={0}
                max={9999}
                inputMode="numeric"
                value={quantities.one ?? 0}
                onChange={(event) =>
                  setQuantities({ one: Math.max(0, Number(event.target.value) || 0) })
                }
                className="rounded-ctl border border-line bg-surface px-3 py-2.5 text-[15px] font-normal tabular-nums"
              />
            </label>
          ) : (
            <>
              <p className="text-[13px] text-muted">{t('sizesHint')}</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {(chart?.values ?? []).map((value) => {
                  const key = String(value.id);
                  const selected = quantities[key] !== undefined;
                  return (
                    <div
                      key={value.id}
                      className={cn(
                        'grid gap-1 rounded-lg border p-2',
                        selected ? 'border-ink' : 'border-line',
                      )}
                    >
                      <label className="flex items-center gap-1.5 text-[13.5px] font-semibold tabular-nums">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(event) =>
                            setQuantities((current) => {
                              const next = { ...current };
                              if (event.target.checked) next[key] = 1;
                              else delete next[key];
                              return next;
                            })
                          }
                        />
                        {value.code}
                      </label>
                      {selected && (
                        <input
                          type="number"
                          min={0}
                          max={9999}
                          inputMode="numeric"
                          aria-label={`${value.code}: ${t('oneSize')}`}
                          value={quantities[key]}
                          onChange={(event) =>
                            setQuantities((current) => ({
                              ...current,
                              [key]: Math.max(0, Number(event.target.value) || 0),
                            }))
                          }
                          className="w-full rounded-md border border-line bg-surface px-2 py-1 text-[14px] tabular-nums"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {fieldErrors.variants && <p className="text-xs text-sale">{fieldErrors.variants}</p>}
        </section>

        <section className="grid gap-3">
          <h2 className="text-[15px] font-bold">{t('sectionPrice')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('originalPrice')}
              inputMode="numeric"
              value={originalPrice}
              onChange={(event) => setOriginalPrice(event.target.value)}
              error={fieldErrors.originalPrice}
            />
            <TextField
              label={t('salePrice')}
              inputMode="numeric"
              value={salePrice}
              onChange={(event) => setSalePrice(event.target.value)}
              error={fieldErrors.salePrice}
            />
          </div>
          {discount !== null && (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <DiscountBadge percent={discount} />
              <span className={discount < minDiscount ? 'text-warn' : 'text-muted'}>
                {discount < minDiscount
                  ? t('discountTooSmall', { min: minDiscount })
                  : t('discountPreview', { percent: discount })}
              </span>
            </div>
          )}
          {product?.referencePrice && (
            <p className="text-[12.5px] text-muted">
              {t('referenceNote', { price: formatPrice(product.referencePrice) })}
            </p>
          )}
        </section>
      </fieldset>

      {formError && (
        <p role="alert" className="rounded-lg bg-sale-soft px-3 py-2 text-[13px] text-sale">
          {formError}
        </p>
      )}
      {editable && (
        <div className="flex flex-wrap gap-2">
          {isPublic ? (
            <Button type="submit" value="save" loading={pending === 'save'}>
              {t('save')}
            </Button>
          ) : (
            <>
              <Button
                type="submit"
                value="publish"
                loading={pending === 'publish'}
                disabled={!canPublish || uploading > 0}
              >
                {t('publish')}
              </Button>
              <Button
                type="submit"
                value="save"
                variant="ghost"
                loading={pending === 'save'}
                disabled={uploading > 0}
              >
                {product ? t('save') : t('saveDraft')}
              </Button>
            </>
          )}
          {isPublic && (
            <Button
              variant="ghost"
              onClick={() => changeStatus('hide')}
              loading={pending === 'hide'}
            >
              {t('hide')}
            </Button>
          )}
          {product && (
            <Button
              variant="text"
              onClick={() => changeStatus('archive')}
              loading={pending === 'archive'}
            >
              {t('archive')}
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
