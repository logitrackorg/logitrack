import type { ShipmentStatus } from "../api/shipments";

const config: Record<ShipmentStatus, { label: string; color: string }> = {
  pending:          { label: "Borrador",           color: "#9ca3af" },
  in_progress:      { label: "En proceso",         color: "#f59e0b" },
  pre_transit:      { label: "Pre-tránsito",       color: "#06b6d4" },
  in_transit:       { label: "En tránsito",        color: "#3b82f6" },
  at_branch:        { label: "En sucursal",        color: "#8b5cf6" },
  delivering:       { label: "En reparto",         color: "#f97316" },
  delivery_failed:  { label: "Entrega fallida",    color: "#ef4444" },
  delivered:        { label: "Entregado",          color: "#10b981" },
  ready_for_pickup: { label: "Listo para retiro",  color: "#0891b2" },
  ready_for_return: { label: "Listo para devolución", color: "#7c3aed" },
  returned:         { label: "Devuelto",           color: "#6b7280" },
  cancelled:        { label: "Cancelado",          color: "#b91c1c" },
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
