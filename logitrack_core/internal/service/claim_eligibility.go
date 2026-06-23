package service

import (
	"time"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
)

// ClaimIneligibleMessage es el texto informativo que se devuelve al cliente
// cuando intenta abrir un reclamo de un tipo que el envío todavía no permite.
// Debe coincidir con CLAIM_INELIGIBLE_MESSAGE en
// logitrack_web/src/utils/claimEligibility.ts.
const ClaimIneligibleMessage = "Tu envío todavía no ha sido entregado. Vas a poder reclamar este tipo una vez entregado."

// CanFileClaim devuelve true cuando el envío permite reclamos "generales"
// (cualquier tipo distinto de maltrato): fue entregado o ya pasó al menos
// 1 hora desde la fecha estimada de entrega.
func CanFileClaim(shipment model.Shipment) bool {
	if shipment.Status == model.StatusDelivered {
		return true
	}
	if shipment.EstimatedDeliveryAt != nil {
		deadline := shipment.EstimatedDeliveryAt.Add(1 * time.Hour)
		if clock.Now().After(deadline) {
			return true
		}
	}
	return false
}

// CanFileClaimOfType es la única fuente de verdad de la regla de elegibilidad
// por tipo de reclamo. Maltrato (bad_treatment) puede iniciarse desde que el
// envío existe, sin importar estado ni SLA, porque puede ocurrir en cualquier
// interacción con el personal. El resto de los tipos respeta CanFileClaim.
// Debe mantenerse en sync con canFileClaimOfType del frontend.
func CanFileClaimOfType(shipment model.Shipment, claimType model.ClaimType) bool {
	if claimType == model.ClaimTypeBadTreatment {
		return true
	}
	return CanFileClaim(shipment)
}
