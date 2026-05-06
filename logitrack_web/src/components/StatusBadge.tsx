import type { ShipmentStatus } from "../api/shipments";

const config: Record<ShipmentStatus, { label: string; bg: string }> = {
  draft:                 { label: "Borrador",              bg: "#9ca3af" },
  at_origin_hub:         { label: "En sucursal origen",    bg: "#f59e0b" },
  loaded:                { label: "Cargado",               bg: "#06b6d4" },
  in_transit:            { label: "En tránsito",           bg: "#3b82f6" },
  at_hub:                { label: "En sucursal",           bg: "#8b5cf6" },
  out_for_delivery:      { label: "En reparto",            bg: "#f97316" },
  delivery_failed:       { label: "Entrega fallida",       bg: "#ef4444" },
  redelivery_scheduled:  { label: "Reentrega programada",  bg: "#fb923c" },
  no_entregado:          { label: "No entregado",          bg: "#dc2626" },
  rechazado:             { label: "Rechazado",             bg: "#991b1b" },
  delivered:             { label: "Entregado",             bg: "#10b981" },
  ready_for_pickup:      { label: "Listo para retiro",     bg: "#0891b2" },
  ready_for_return:      { label: "Listo para devolución", bg: "#7c3aed" },
  returned:              { label: "Devuelto",              bg: "#6b7280" },
  cancelled:             { label: "Cancelado",             bg: "#b91c1c" },
  lost:                  { label: "Extraviado",            bg: "#374151" },
  destroyed:             { label: "Daño total",            bg: "#111827" },
};

export function StatusBadge({ status }: { status: ShipmentStatus }) {
  const cfg = config[status] ?? { label: status, bg: "#9ca3af" };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 10px",
      borderRadius: 12,
      fontSize: 12,
      fontWeight: 600,
      whiteSpace: "nowrap",
      background: cfg.bg,
      color: "#fff",
    }}>
      {cfg.label}
    </span>
  );
}
