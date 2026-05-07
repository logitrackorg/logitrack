import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Section — a labeled grouping inside a Card or page.
 * Modern replacement for `<fieldset>` with consistent spacing.
 */
type SectionProps = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function Section({ title, description, actions, children, className }: SectionProps) {
  return (
    <section className={cn("space-y-3", className)}>
      {(title || actions) && (
        <div className="flex items-baseline justify-between gap-3">
          <div>
            {title && (
              <h3 className="text-sm font-semibold text-slate-900 tracking-tight">{title}</h3>
            )}
            {description && (
              <p className="mt-0.5 text-xs text-slate-500">{description}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
