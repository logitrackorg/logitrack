import type { ShipmentStatus } from "../api/shipments";

// Minimal shape needed to compute a context-aware label override. Both the
// authenticated `Shipment` and the public `PublicShipment` types satisfy this.
interface StatusContext {
  status: ShipmentStatus;
  current_location?: string;
  final_branch_id?: string;
}

// Returns a label override for the shipment's status when context-dependent
// wording is needed. Today only `at_hub` differs: when the shipment is sitting
// at its `final_branch_id` (the destination set at creation), we show
// "En sucursal de destino" instead of the generic "En sucursal".
//
// Returns undefined when the default label from StatusBadge should be used.
export function shipmentStatusLabelOverride(shipment: StatusContext): string | undefined {
  if (
    shipment.status === "at_hub" &&
    shipment.final_branch_id &&
    shipment.current_location === shipment.final_branch_id
  ) {
    return "En sucursal de destino";
  }
  return undefined;
}
