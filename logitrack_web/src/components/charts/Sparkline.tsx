import { LineChart, Line, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

/**
 * Sparkline — minimal Recharts LineChart with hidden axes, no grid/legend/tooltip.
 * Just a colored line showing a trend.
 */

export type SparklineDataPoint = {
  /** X-axis value (typically a label, index, or timestamp). */
  x: string | number;
  /** Y-axis value (the data point). */
  y: number;
};

export type SparklineProps = {
  /** Array of data points to plot. */
  data: SparklineDataPoint[];
  /** Line color. Defaults to blue #2563eb. */
  color?: string;
  /** Fill color for the area under the line. Defaults to blue at low opacity. */
  fill?: string;
  /** Width of the chart container in pixels. Defaults to 120. */
  width?: number;
  /** Height of the chart container in pixels. Defaults to 40. */
  height?: number;
  /** Stroke width of the line. Defaults to 2. */
  strokeWidth?: number;
  /** Additional class name for the outer container. */
  className?: string;
};

export function Sparkline({
  data,
  color = "#2563eb",
  fill = "rgba(37,99,235,0.1)",
  width = 120,
  height = 40,
  strokeWidth = 2,
  className,
}: SparklineProps) {
  return (
    <div className={cn("inline-block", className)} style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line
            type="monotone"
            dataKey="y"
            stroke={color}
            fill={fill}
            fillOpacity={1}
            strokeWidth={strokeWidth}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}