import type { ProductStatus } from '@lastsize/contracts';
import { Pill, type PillTone } from '@lastsize/ui';
import { getTranslations } from 'next-intl/server';

const TONES: Record<ProductStatus, PillTone> = {
  DRAFT: 'muted',
  ACTIVE: 'ok',
  HIDDEN: 'muted',
  FLAGGED: 'warn',
  REMOVED: 'sale',
  ARCHIVED: 'muted',
};

export async function ProductStatusPill({ status }: { status: ProductStatus }) {
  const t = await getTranslations('products');
  return <Pill tone={TONES[status]}>{t(`status.${status}`)}</Pill>;
}
