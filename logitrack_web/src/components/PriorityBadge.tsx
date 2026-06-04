import type { Priority } from "../api/shipments";

const LABELS: Record<string, string> = {
  alta:  "Alta",
  media: "Media",
  baja:  "Baja",
};

const STYLES: Record<string, string> = {
  alta:  "bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
  media: "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
  baja:  "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
};

export function PriorityBadge({ priority }: { priority?: Priority | string }) {
  if (!priority || !LABELS[priority]) return null;
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide border ${STYLES[priority]}`}
    >
      {LABELS[priority]}
    </span>
  );
}
