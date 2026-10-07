import type { ReactNode } from 'react';
import { cn } from './cn';
import { formatDiscount } from './format';

export type PillTone = 'sale' | 'ok' | 'warn' | 'info' | 'muted';

const tones: Record<PillTone, string> = {
  sale: 'bg-sale text-on-sale',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  info: 'bg-info-soft text-info',
  muted: 'bg-soft text-muted',
};

export function Pill({
  tone = 'muted',
  children,
  className,
}: {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The discount tag on product photos. Always in the same corner, always red. */
export function DiscountBadge({ percent, className }: { percent: number; className?: string }) {
  return (
    <span
      className={cn(
        'rounded-[3px] bg-sale px-1.5 py-[3px] font-display text-[11px] font-bold tracking-wide text-on-sale',
        className,
      )}
    >
      {formatDiscount(percent)}
    </span>
  );
}
