import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * StatCard — compact KPI tile for dashboards.
 * Supports an optional trend indicator, tone variants, and an accent color strip.
 */
type StatCardProps = {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "info";
  accentColor?: string;
  extra?: React.ReactNode;
  className?: string;
  onClick?: () => void;
};

const TONE_STYLES: Record<NonNullable<StatCardProps["tone"]>, { iconBg: string; iconColor: string }> = {
  default: { iconBg: "bg-blue-50 dark:bg-blue-500/15", iconColor: "text-blue-600 dark:text-blue-400" },
  success: { iconBg: "bg-emerald-50 dark:bg-emerald-500/15", iconColor: "text-emerald-600 dark:text-emerald-400" },
  warning: { iconBg: "bg-orange-50 dark:bg-orange-500/15", iconColor: "text-orange-600 dark:text-orange-400" },
  danger: { iconBg: "bg-rose-50 dark:bg-rose-500/15", iconColor: "text-rose-600 dark:text-rose-400" },
  info: { iconBg: "bg-sky-50 dark:bg-sky-500/15", iconColor: "text-sky-600 dark:text-sky-400" },
};

export function StatCard({ label, value, hint, icon, tone = "default", accentColor, extra, className, onClick }: StatCardProps) {
  const t = TONE_STYLES[tone];
  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-5 shadow-sm transition-shadow duration-200 relative",
        onClick && "cursor-pointer hover:border-slate-300 dark:hover:border-gray-600 hover:shadow-md",
        className,
      )}
    >
      {accentColor && (
        <span
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full"
          style={{ backgroundColor: accentColor }}
        />
      )}
      <div className={cn("flex items-start justify-between gap-3 mb-3", accentColor && "pl-2")}>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
        {icon && (
          <div
            className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", !accentColor && t.iconBg, !accentColor && t.iconColor)}
            style={accentColor ? { backgroundColor: accentColor + "1A", color: accentColor } : undefined}
          >
            {icon}
          </div>
        )}
      </div>
      <p className={cn("text-3xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-white", accentColor && "pl-2")}>{value}</p>
      {hint && <p className={cn("mt-1 text-xs text-slate-500 dark:text-slate-400", accentColor && "pl-2")}>{hint}</p>}
      {extra && <div className="mt-2">{extra}</div>}
    </div>
  );
}
