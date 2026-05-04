import type { ShipmentStatus } from "../api/shipments";

const config: Record<ShipmentStatus, { label: string; color: string }> = {
  draft:                 { label: "Borrador",                color: "#9ca3af" },
  at_origin_hub:         { label: "En sucursal de origen",        color: "#f59e0b" },
  loaded:                { label: "Cargado",                 color: "#06b6d4" },
  in_transit:            { label: "En tránsito",             color: "#3b82f6" },
  at_hub:                { label: "En sucursal",                  color: "#8b5cf6" },
  out_for_delivery:      { label: "En reparto",              color: "#f97316" },
  delivery_failed:       { label: "Entrega fallida",         color: "#ef4444" },
  redelivery_scheduled:  { label: "Reentrega programada",    color: "#fb923c" },
  no_entregado:          { label: "No entregado",            color: "#dc2626" },
  rechazado:             { label: "Rechazado",               color: "#991b1b" },
  delivered:             { label: "Entregado",               color: "#10b981" },
  ready_for_pickup:      { label: "Listo para retiro",       color: "#0891b2" },
  ready_for_return:      { label: "Listo para devolución",   color: "#7c3aed" },
  returned:              { label: "Devuelto",                color: "#6b7280" },
  cancelled:             { label: "Cancelado",               color: "#b91c1c" },
  lost:                  { label: "Extraviado",              color: "#374151" },
  destroyed:             { label: "Daño total",              color: "#111827" },
};

export function StatusBadge({ status }: { status: ShipmentStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      {LABELS[status]}
    </span>
  );
}
