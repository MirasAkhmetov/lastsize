import { forwardRef, type InputHTMLAttributes, useId } from 'react';
import { cn } from './cn';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
  id?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, id, className, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className={cn('grid min-w-0 gap-1.5', className)}>
      <label htmlFor={inputId} className="text-[12.5px] font-semibold">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'w-full rounded-ctl border bg-surface px-3 py-2.5 text-[15px] text-ink placeholder:text-muted',
          error ? 'border-sale' : 'border-line focus:border-ink',
        )}
        {...props}
      />
      {error ? (
        <p id={`${inputId}-error`} className="text-xs text-sale">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
