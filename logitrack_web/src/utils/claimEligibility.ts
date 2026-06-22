import type { ClaimType } from "../api/publicTracking";

export const CLAIM_INELIGIBLE_MESSAGE =
  "Tu envío todavía no ha sido entregado. Vas a poder reclamar este tipo una vez entregado.";

// Mínimo shape requerido para evaluar elegibilidad. Tanto `PublicShipment`
// (utilizado por el formulario público) como el `Shipment` del chatbot
// cumplen este contrato, así que la regla vive en un solo lugar.
export interface ClaimEligibilityShipment {
  status: string;
  estimated_delivery_at?: string | null;
}

// canFileClaim devuelve true cuando el envío permite reclamos generales:
// fue entregado o ya pasó al menos 1 hora desde la fecha estimada de entrega.
// Mantiene el mismo criterio que `canFileClaim` en
// logitrack_core/internal/handler/chatbot_handler.go.
export function canFileClaim(shipment: ClaimEligibilityShipment): boolean {
  if (shipment.status === "delivered") return true;
  const eta = shipment.estimated_delivery_at;
  if (!eta) return false;
  const deadline = new Date(eta).getTime() + 60 * 60 * 1000;
  return Date.now() > deadline;
}

// canFileClaimOfType extiende la regla general: maltrato es siempre reclamable
// desde que el envío existe (no depende del estado ni del SLA), porque puede
// ocurrir en cualquier interacción. El resto de los tipos respeta canFileClaim.
export function canFileClaimOfType(
  shipment: ClaimEligibilityShipment,
  claimType: ClaimType,
): boolean {
  if (claimType === "bad_treatment") return true;
  return canFileClaim(shipment);
}
