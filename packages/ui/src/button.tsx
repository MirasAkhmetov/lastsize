import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'sale' | 'ghost' | 'text';
export type ButtonSize = 'md' | 'sm';

const base =
  'inline-flex items-center justify-center gap-2 rounded-ctl font-semibold leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-40';
const variants: Record<ButtonVariant, string> = {
  // Main actions in the product are black; red is reserved for the single "see the sale" entry.
  primary: 'bg-ink text-paper hover:opacity-90',
  sale: 'bg-sale text-on-sale hover:opacity-90',
  ghost: 'border border-line bg-transparent text-ink hover:bg-soft',
  text: 'bg-transparent px-1 text-ink underline underline-offset-4 hover:opacity-80',
};
const sizes: Record<ButtonSize, string> = {
  md: 'px-[18px] py-[11px] text-sm',
  sm: 'px-3 py-[7px] text-[13px]',
};

/** Class names for links that look like buttons. */
export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  block = false,
): string {
  return cn(base, variants[variant], variant !== 'text' && sizes[size], block && 'w-full');
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    block = false,
    loading = false,
    className,
    disabled,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonClasses(variant, size, block), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && (
        <span
          aria-hidden
          className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      )}
      {children}
    </button>
  );
});
