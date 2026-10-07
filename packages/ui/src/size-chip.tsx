import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

export type SizeState = 'available' | 'last' | 'unavailable';

export interface SizeChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  state: SizeState;
  selected?: boolean;
  /** Screen-reader text for the "last one" dot, e.g. "последний". */
  lastLabel?: string;
  unavailableLabel?: string;
}

/**
 * A size button. Sold-out sizes stay visible (crossed out) so buyers see the full range,
 * but cannot be selected.
 */
export function SizeChip({
  label,
  state,
  selected = false,
  lastLabel = 'последний',
  unavailableLabel = 'нет в наличии',
  className,
  ...props
}: SizeChipProps) {
  const unavailable = state === 'unavailable';
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={unavailable}
      className={cn(
        'relative inline-grid h-10 min-w-11 place-items-center rounded-lg border bg-surface px-2 text-[13.5px] font-medium tabular-nums',
        selected ? 'border-2 border-ink' : 'border-line hover:border-ink',
        unavailable &&
          'cursor-not-allowed text-muted line-through [background:repeating-linear-gradient(135deg,transparent_0_6px,var(--soft)_6px_7px)] hover:border-line',
        className,
      )}
      {...props}
    >
      {label}
      {state === 'last' && (
        <>
          <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-sale" />
          <span className="sr-only">, {lastLabel}</span>
        </>
      )}
      {unavailable && <span className="sr-only">, {unavailableLabel}</span>}
    </button>
  );
}
