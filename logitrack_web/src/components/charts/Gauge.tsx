import { cn } from "@/lib/utils";

/**
 * Gauge — SVG semicircular gauge with colored zones, needle, and center value.
 * Pure SVG, no external chart library required.
 */

export type GaugeThreshold = {
  /** The value at which this threshold zone ends. Zones span from the previous threshold (or min) to this value. */
  value: number;
  /** CSS color string for the zone arc segment. */
  color: string;
};

export type GaugeProps = {
  /** Current value to display. */
  value: number;
  /** Minimum value of the scale. Defaults to 0. */
  min?: number;
  /** Maximum value of the scale. */
  max: number;
  /** Threshold zones defining color segments. Each entry defines the end value and color of a zone. */
  thresholds: GaugeThreshold[];
  /** Label shown below the value. */
  label?: string;
  /** Unit suffix shown next to the value (e.g. "%", "km/h"). */
  unit?: string;
  /** Additional class name for the outer container. */
  className?: string;
};

const SVG_WIDTH = 200;
const SVG_HEIGHT = 120;
const ARC_CENTER_X = 100;
const ARC_CENTER_Y = 100;
const ARC_RADIUS = 80;
const ARC_STROKE_WIDTH = 16;

/**
 * Convert a value on the gauge scale to an angle in degrees.
 * 0° = left end of semicircle, 180° = right end.
 */
function valueToAngle(value: number, min: number, max: number): number {
  const clamped = Math.min(Math.max(value, min), max);
  return ((clamped - min) / (max - min)) * 180;
}

/**
 * Convert an angle (0° = left, 180° = right) to SVG arc coordinates.
 * Returns [x, y] on the arc circle.
 */
function angleToPoint(angleDeg: number): [number, number] {
  // SVG angle: 0° = 3 o'clock. We want 0° = 9 o'clock (left), 180° = 3 o'clock (right).
  const svgAngle = (180 - angleDeg) * (Math.PI / 180);
  return [
    ARC_CENTER_X + ARC_RADIUS * Math.cos(svgAngle),
    ARC_CENTER_Y - ARC_RADIUS * Math.sin(svgAngle),
  ];
}

/**
 * Build an SVG arc path for a segment from startAngle to endAngle.
 */
function arcPath(startAngle: number, endAngle: number): string {
  const [x1, y1] = angleToPoint(startAngle);
  const [x2, y2] = angleToPoint(endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${ARC_RADIUS} ${ARC_RADIUS} 0 ${largeArc} 1 ${x2} ${y2}`;
}

export function Gauge({
  value,
  min = 0,
  max,
  thresholds,
  label,
  unit,
  className,
}: GaugeProps) {
  // Build zone segments from thresholds
  const zones: { startAngle: number; endAngle: number; color: string }[] = [];
  let prevValue = min;
  for (const t of thresholds) {
    const startAngle = valueToAngle(prevValue, min, max);
    const endAngle = valueToAngle(t.value, min, max);
    zones.push({ startAngle, endAngle, color: t.color });
    prevValue = t.value;
  }

  // Needle angle
  const needleAngle = valueToAngle(value, min, max);
  const needleLength = ARC_RADIUS - ARC_STROKE_WIDTH / 2 - 6;

  // Calculate needle tip position at the shorter length
  const svgAngle = (180 - needleAngle) * (Math.PI / 180);
  const tipX = ARC_CENTER_X + needleLength * Math.cos(svgAngle);
  const tipY = ARC_CENTER_Y - needleLength * Math.sin(svgAngle);

  const displayValue = Math.round(value * 10) / 10;

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <svg
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        width={SVG_WIDTH}
        height={SVG_HEIGHT}
        className="overflow-visible"
        role="img"
        aria-label={`${label ?? "Gauge"}: ${displayValue}${unit ?? ""}`}
      >
        {/* Background track */}
        <path
          d={arcPath(0, 180)}
          fill="none"
          stroke="var(--gray-200, #e2e8f0)"
          strokeWidth={ARC_STROKE_WIDTH}
          strokeLinecap="round"
        />

        {/* Colored zone segments */}
        {zones.map((zone, i) => (
          <path
            key={i}
            d={arcPath(zone.startAngle, zone.endAngle)}
            fill="none"
            stroke={zone.color}
            strokeWidth={ARC_STROKE_WIDTH}
            strokeLinecap={i === 0 || i === zones.length - 1 ? "round" : "butt"}
          />
        ))}

        {/* Needle */}
        <line
          x1={ARC_CENTER_X}
          y1={ARC_CENTER_Y}
          x2={tipX}
          y2={tipY}
          stroke="var(--gray-900, #111827)"
          strokeWidth={2.5}
          strokeLinecap="round"
        />

        {/* Needle center dot */}
        <circle
          cx={ARC_CENTER_X}
          cy={ARC_CENTER_Y}
          r={5}
          fill="var(--gray-900, #111827)"
        />
      </svg>

      {/* Center value */}
      <div className="flex flex-col items-center -mt-2">
        <span className="text-2xl font-bold tabular-nums tracking-tight text-slate-900">
          {displayValue}
          {unit && (
            <span className="text-sm font-semibold text-slate-500 ml-0.5">{unit}</span>
          )}
        </span>
        {label && (
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}