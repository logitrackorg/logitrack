import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * PageHeader — consistent header for top-level pages.
 *
 *   <PageHeader
 *     title="Envíos"
 *     description="Gestión y seguimiento del flujo logístico"
 *     actions={<Button>+ Nuevo envío</Button>}
 *   />
 */
type PageHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
};

export function PageHeader({ title, description, actions, icon, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-4 mb-6 pb-4 border-b border-slate-200",
        className,
      )}
    >
      <div className="flex items-start gap-3 min-w-0 flex-1">
        {icon && (
          <div className="w-10 h-10 rounded-xl bg-[#1e3a5f]/8 text-[#1e3a5f] flex items-center justify-center shrink-0">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight leading-tight">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-slate-500 leading-relaxed">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
