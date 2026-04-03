import type { ShipmentStatus } from "../api/shipments";

const config: Record<ShipmentStatus, { label: string; color: string }> = {
  pending:          { label: "Draft",           color: "#9ca3af" },
  in_progress:      { label: "In Progress",    color: "#f59e0b" },
  pre_transit:      { label: "Pre-Transit",    color: "#06b6d4" },
  in_transit:       { label: "In Transit",     color: "#3b82f6" },
  at_branch:        { label: "At Branch",      color: "#8b5cf6" },
  delivering:       { label: "Delivering",     color: "#f97316" },
  delivery_failed:  { label: "Delivery Failed",      color: "#ef4444" },
  delivered:        { label: "Delivered",            color: "#10b981" },
  ready_for_pickup: { label: "Ready for pickup",      color: "#0891b2" },
  ready_for_return: { label: "Ready for return",      color: "#7c3aed" },
  returned:         { label: "Returned",               color: "#6b7280" },
  cancelled:        { label: "Cancelled",               color: "#b91c1c" },
};

export function StatusBadge({ status }: { status: ShipmentStatus }) {
  const { label, color } = config[status];
  return (
    <span
      style={{
        background: color,
        color: "#fff",
        padding: "2px 10px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}
