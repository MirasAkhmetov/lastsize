import type { ReactNode } from 'react';
import { cn } from './cn';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-skeleton rounded bg-[linear-gradient(90deg,var(--soft)_25%,var(--line)_50%,var(--soft)_75%)] bg-[length:200%_100%]',
        className,
      )}
    />
  );
}

/** Placeholder card while products load: keeps the grid from jumping. */
export function ProductCardSkeleton() {
  return (
    <div className="grid gap-1.5" aria-hidden>
      <Skeleton className="aspect-[3/4] rounded-img" />
      <Skeleton className="h-2.5 w-3/5" />
      <Skeleton className="h-2.5 w-4/5" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** Says what is missing and what to do next. Never a dead end. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'grid justify-items-center gap-2 rounded-xl border border-dashed border-line bg-surface px-4 py-8 text-center',
        className,
      )}
    >
      {icon && (
        <div
          className="grid size-11 place-items-center rounded-full bg-soft font-display font-bold"
          aria-hidden
        >
          {icon}
        </div>
      )}
      <h2 className="text-[15px] font-bold">{title}</h2>
      {description && <p className="max-w-[34ch] text-[13px] text-muted">{description}</p>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

export function Notice({
  tone = 'warn',
  children,
}: {
  tone?: 'warn' | 'info';
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        'rounded-lg px-2.5 py-2 text-[12.5px] leading-snug',
        tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-info-soft text-info',
      )}
    >
      {children}
    </p>
  );
}
