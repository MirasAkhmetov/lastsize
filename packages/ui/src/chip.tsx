import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

/** Filter chip: "Мой размер", "-50% и больше", "Самовывоз сегодня". */
export function Chip({ active = false, className, children, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px]',
        active
          ? 'border-ink bg-ink text-paper'
          : 'border-line bg-surface text-ink hover:border-ink',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
