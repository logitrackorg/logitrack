import type { Priority } from "../api/shipments";

const LABELS: Record<string, string> = {
  alta:  "Alta",
  media: "Media",
  baja:  "Baja",
};

export function PriorityBadge({ priority }: { priority?: Priority | string }) {
  if (!priority || !LABELS[priority]) return null;
  return (
    <span className={`badge-priority badge-${priority}`}>
      {LABELS[priority]}
    </span>
  );
}
