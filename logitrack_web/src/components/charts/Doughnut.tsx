import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

/**
 * Doughnut — Recharts PieChart with innerRadius/outerRadius for a doughnut effect.
 * Renders a center label and value inside the ring.
 */

export type DoughnutDataItem = {
  /** Display name for the segment. */
  name: string;
  /** Numeric value for the segment. */
  value: number;
  /** CSS color string for the segment. */
  color: string;
};

export type DoughnutProps = {
  /** Array of data segments to render. */
  data: DoughnutDataItem[];
  /** Label text shown in the center of the doughnut. */
  centerLabel?: string;
  /** Value text shown in the center of the doughnut. */
  centerValue?: string | number;
  /** Outer radius of the doughnut ring. Defaults to 70. */
  outerRadius?: number;
  /** Inner radius of the doughnut ring. Defaults to 45. */
  innerRadius?: number;
  /** Width and height of the chart container in pixels. Defaults to 160. */
  size?: number;
  /** Additional class name for the outer container. */
  className?: string;
};

export function Doughnut({
  data,
  centerLabel,
  centerValue,
  outerRadius = 70,
  innerRadius = 45,
  size = 160,
  className,
}: DoughnutProps) {
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <ResponsiveContainer width={size} height={size}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            strokeWidth={0}
            paddingAngle={2}
          >
            {data.map((entry, index) => (
              <Cell key={index} fill={entry.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      {/* Center label overlay */}
      {(centerLabel !== undefined || centerValue !== undefined) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {centerValue !== undefined && (
            <span className="text-xl font-bold tabular-nums tracking-tight text-slate-900">
              {centerValue}
            </span>
          )}
          {centerLabel && (
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {centerLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}