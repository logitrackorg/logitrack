import type { Priority } from "../api/shipments";

interface PriorityBadgeProps {
  priority?: Priority | string;
}

const PRIORITY_CONFIG: Record<string, { label: string; bg: string; color: string; border: string }> = {
  alta:  { label: "High",  bg: "#fef2f2", color: "#dc2626", border: "#fca5a5" },
  media: { label: "Medium", bg: "#fffbeb", color: "#d97706", border: "#fde68a" },
  baja:  { label: "Low",   bg: "#f0fdf4", color: "#16a34a", border: "#86efac" },
};

export function PriorityBadge({ priority }: PriorityBadgeProps) {
  if (!priority) return null;
  const config = PRIORITY_CONFIG[priority];
  if (!config) return null;

  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 700,
      textTransform: "uppercase" as const,
      letterSpacing: 0.3,
      background: config.bg,
      color: config.color,
      border: `1px solid ${config.border}`,
    }}>
      {config.label}
    </span>
  );
}
