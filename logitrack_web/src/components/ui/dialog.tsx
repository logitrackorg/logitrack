import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/* ─── Dialog (backdrop) ──────────────────────────────────── */

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Dialog — fullscreen fixed backdrop that closes on click-outside.
 * Content clicks are stopped via `stopPropagation` inside `DialogContent`.
 */
export function Dialog({ open, onClose, children }: DialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 dark:bg-black/50 animate-fade-in transition-colors duration-200"
      onClick={onClose}
    >
      {children}
    </div>
  );
}

/* ─── DialogContent ──────────────────────────────────────── */

interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * DialogContent — the modal card itself.
 * Default max-width 480 px; override via `className`.
 * `stopPropagation` prevents backdrop close when clicking inside.
 */
export function DialogContent({ className, children, ...props }: DialogContentProps) {
  return (
    <div
      className={cn(
        "relative bg-[var(--bg-card)] dark:bg-[var(--bg-elevated)] rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.25)] max-w-[480px] w-[calc(100%-2rem)] max-h-[90vh] overflow-y-auto animate-fade-in transition-colors duration-200",
        className,
      )}
      onClick={(e) => e.stopPropagation()}
      {...props}
    >
      {children}
    </div>
  );
}

/* ─── DialogHeader ───────────────────────────────────────── */

interface DialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** When provided, renders a close button (× icon) in the header. */
  onClose?: () => void;
  children: React.ReactNode;
}

/**
 * DialogHeader — top section with title area and optional close button.
 * Pass `onClose` to show the close button; omit to hide it.
 */
export function DialogHeader({ className, children, onClose, ...props }: DialogHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-3 p-6 pb-3", className)} {...props}>
      <div className="flex-1 min-w-0">{children}</div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="cursor-pointer shrink-0 rounded-md p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)] transition-colors duration-200"
        >
          <X size={18} />
        </button>
      )}
    </div>
  );
}

/* ─── DialogTitle ────────────────────────────────────────── */

/**
 * DialogTitle — bold heading for the dialog.
 * Use inside `<DialogHeader>`.
 */
export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn("text-lg font-bold text-[var(--text-heading)]", className)}
      {...props}
    />
  );
}

/* ─── DialogFooter ───────────────────────────────────────── */

interface DialogFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * DialogFooter — bottom action bar.
 * Renders children (typically `<Button>` elements) right-aligned.
 */
export function DialogFooter({ className, children, ...props }: DialogFooterProps) {
  return (
    <div
      className={cn("flex items-center gap-2 justify-end p-6 pt-3", className)}
      {...props}
    >
      {children}
    </div>
  );
}
