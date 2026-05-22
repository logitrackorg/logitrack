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
  /** Hex color for a left accent strip (e.g. status badge color) */
  accentColor?: string;
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

export function StatCard({ label, value, hint, icon, tone = "default", accentColor, className, onClick }: StatCardProps) {
  const t = TONE_STYLES[tone];
  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-xl bg-white border border-slate-200 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all relative",
        onClick && "cursor-pointer hover:border-slate-300 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)]",
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
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        {icon && (
          <div
            className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", !accentColor && t.iconBg, !accentColor && t.iconColor)}
            style={accentColor ? { backgroundColor: accentColor + "1A", color: accentColor } : undefined}
          >
            {icon}
          </div>
        )}
      </div>
      <p className={cn("text-3xl font-bold tabular-nums tracking-tight text-slate-900", accentColor && "pl-2")}>{value}</p>
      {hint && <p className={cn("mt-1 text-xs text-slate-500", accentColor && "pl-2")}>{hint}</p>}
    </div>
  );
}
