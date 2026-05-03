import type { ShipmentStatus } from "../api/shipments";

const LABELS: Record<ShipmentStatus, string> = {
  pending:          "Borrador",
  in_progress:      "En proceso",
  pre_transit:      "Pre-tránsito",
  in_transit:       "En tránsito",
  at_branch:        "En sucursal",
  delivering:       "En reparto",
  delivery_failed:  "Entrega fallida",
  delivered:        "Entregado",
  ready_for_pickup: "Listo para retiro",
  ready_for_return: "Listo para devolución",
  returned:         "Devuelto",
  cancelled:        "Cancelado",
};

export function StatusBadge({ status }: { status: ShipmentStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      {LABELS[status]}
    </span>
  );
}
