import * as React from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
};

export function BottomSheet({ open, onClose, title, description, children, className }: BottomSheetProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative w-full sm:max-w-md bg-[var(--bg-card)] rounded-t-2xl sm:rounded-2xl shadow-2xl border-t sm:border border-slate-200 dark:border-gray-700",
          "max-h-[92vh] overflow-y-auto",
          "pb-[env(safe-area-inset-bottom,0px)]",
          "animate-in slide-in-from-bottom-4 fade-in duration-200",
          className,
        )}
      >
        <div className="sticky top-0 bg-[var(--bg-card)] border-b border-[var(--border)] px-5 pt-3 pb-3 rounded-t-2xl">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-600 sm:hidden" />
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold text-[var(--text-primary)] tracking-tight">{title}</h2>
              {description && <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{description}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="shrink-0 w-9 h-9 rounded-full hover:bg-[var(--bg-muted)] flex items-center justify-center text-[var(--text-muted)] cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
