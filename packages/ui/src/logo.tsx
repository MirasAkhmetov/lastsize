import { cn } from './cn';

export function Logo({ className, suffix }: { className?: string; suffix?: string }) {
  return (
    <span className={cn('font-display font-black tracking-tight', className)}>
      last<span className="text-sale">size</span>
      {suffix && (
        <span className="ml-1.5 font-sans text-[0.55em] font-medium tracking-normal text-muted">
          {suffix}
        </span>
      )}
    </span>
  );
}
