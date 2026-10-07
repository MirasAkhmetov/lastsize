'use client';

import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { cn } from './cn';

interface OverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
}

/** Centered modal, only for confirming irreversible actions. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  closeLabel = 'Закрыть',
}: OverlayProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <RadixDialog.Content className="fixed top-1/2 left-1/2 z-50 grid w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-sheet bg-surface p-5 shadow-xl">
          <RadixDialog.Title className="text-lg font-bold">{title}</RadixDialog.Title>
          {description && (
            <RadixDialog.Description className="text-sm text-muted">
              {description}
            </RadixDialog.Description>
          )}
          {children}
          {footer && <div className="flex justify-end gap-2 pt-2">{footer}</div>}
          <RadixDialog.Close className="absolute top-3 right-3 text-muted" aria-label={closeLabel}>
            ✕
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Bottom sheet on phones, right-hand drawer from tablet width up (filters, sorting, size pickers). */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  closeLabel = 'Закрыть',
}: OverlayProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <RadixDialog.Content
          className={cn(
            'fixed z-50 flex flex-col bg-surface shadow-xl',
            'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-sheet pb-[env(safe-area-inset-bottom)]',
            'md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[400px] md:rounded-none md:rounded-l-sheet',
          )}
        >
          <div aria-hidden className="mx-auto mt-2 h-1 w-9 rounded-full bg-line md:hidden" />
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <RadixDialog.Title className="text-base font-bold">{title}</RadixDialog.Title>
            <RadixDialog.Close className="text-muted" aria-label={closeLabel}>
              ✕
            </RadixDialog.Close>
          </div>
          {description && (
            <RadixDialog.Description className="px-4 text-sm text-muted">
              {description}
            </RadixDialog.Description>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">{children}</div>
          {footer && <div className="border-t border-line p-4">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
