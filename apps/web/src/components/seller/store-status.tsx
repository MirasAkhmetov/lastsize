import type { StoreStatus } from '@lastsize/contracts';
import { buttonClasses, Pill, type PillTone } from '@lastsize/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

const TONES: Record<StoreStatus, PillTone> = {
  PENDING_VERIFICATION: 'warn',
  VERIFIED: 'ok',
  REJECTED: 'sale',
  BLOCKED: 'sale',
};

/** Where the store stands in verification, and what the seller should do next. */
export async function StoreStatusCard({
  name,
  status,
  reason,
  showLink,
}: {
  name: string;
  status: StoreStatus;
  reason: string | null;
  showLink: boolean;
}) {
  const t = await getTranslations('store');
  return (
    <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">{name}</h2>
        <Pill tone={TONES[status]}>{t(`status.${status}`)}</Pill>
      </div>
      <p className="text-[14px] text-muted">{t(`statusText.${status}`)}</p>
      {reason && (
        <p className="rounded-lg bg-sale-soft px-3 py-2 text-[13.5px] text-sale">
          <span className="font-semibold">{t('reason')}:</span> {reason}
        </p>
      )}
      {showLink && status !== 'BLOCKED' && (
        <Link
          href="/seller/store"
          className={
            buttonClasses(status === 'REJECTED' ? 'primary' : 'ghost', 'sm') + ' justify-self-start'
          }
        >
          {status === 'REJECTED' ? t('fixStore') : t('openStore')}
        </Link>
      )}
    </section>
  );
}
