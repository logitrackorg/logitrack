import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * StatCard — compact KPI tile for dashboards.
 * Supports an optional trend indicator and tone variants for status colors.
 */
type StatCardProps = {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "info";
  className?: string;
  onClick?: () => void;
};

const TONE_STYLES: Record<NonNullable<StatCardProps["tone"]>, { iconBg: string; iconColor: string }> = {
  default: { iconBg: "bg-[#1e3a5f]/8", iconColor: "text-[#1e3a5f]" },
  success: { iconBg: "bg-emerald-50", iconColor: "text-emerald-600" },
  warning: { iconBg: "bg-amber-50", iconColor: "text-amber-600" },
  danger: { iconBg: "bg-rose-50", iconColor: "text-rose-600" },
  info: { iconBg: "bg-sky-50", iconColor: "text-sky-600" },
};

export function StatCard({ label, value, hint, icon, tone = "default", className, onClick }: StatCardProps) {
  const t = TONE_STYLES[tone];
  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-xl bg-white border border-slate-200 p-5 shadow-sm transition-all",
        onClick && "cursor-pointer hover:border-slate-300 hover:shadow-md",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        {icon && (
          <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", t.iconBg, t.iconColor)}>
            {icon}
          </div>
        )}
      </div>
      <p className="text-3xl font-bold tabular-nums tracking-tight text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
