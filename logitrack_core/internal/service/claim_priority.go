package service

import "github.com/logitrack/core/internal/model"

// ClaimPriorityInput contiene los datos del reclamo que se ven al momento del
// cálculo de prioridad. Es una proyección estrecha (no la entidad Claim
// completa) para que la función sea pura y fácil de testear sin depender de
// estructuras transitorias o sin terminar.
type ClaimPriorityInput struct {
	Type        model.ClaimType
	HasEvidence bool
}

// ShipmentPriorityInfo contiene los campos del envío relevantes para el
// cálculo de prioridad. Mantener una struct específica permite testear sin
// armar un model.Shipment completo y aísla el cálculo de futuros cambios al
// modelo de envíos.
type ShipmentPriorityInfo struct {
	Status                model.Status
	PriorityScore         float64
	SLAExpired            bool
	DeliveryAttemptCount  int
}

// CalculatePriority decide la prioridad de un ticket nuevo en base al tipo,
// la evidencia adjunta y el contexto del envío. Es pura: no consulta la DB ni
// muta nada. La regla de tope de urgentes vive en el servicio (porque depende
// de cuántos urgentes ya hay abiertos en la sucursal); acá solo decidimos la
// prioridad "natural" según las reglas de negocio.
//
// Las reglas se evalúan en orden de precedencia: la primera que aplica gana.
//
//  1. urgente — riesgo material o legal: envío extraviado/destruido, daño con
//     evidencia mientras el envío sigue activo, o SLA ya vencido.
//  2. alta    — incumplimiento alto-impacto: score ML >= umbral high, envío
//     extraviado o ya con 3+ intentos fallidos.
//  3. media   — incumplimiento moderado: score ML >= umbral medium o tipos
//     que el negocio clasifica como sensibles aún sin evidencia.
//  4. baja    — el resto.
//
// note solo se setea cuando hay algo no obvio que justificar (por ahora vacío;
// el wrapper en el servicio puede sobreescribirlo si degrada por tope).
func CalculatePriority(claim ClaimPriorityInput, shipment ShipmentPriorityInfo, cfg model.SystemConfig) (priority model.ClaimPriority, note string) {
	if isUrgent(claim, shipment) {
		return model.ClaimPriorityUrgente, ""
	}
	if isHigh(claim, shipment, cfg) {
		return model.ClaimPriorityAlta, ""
	}
	if isMedium(claim, shipment, cfg) {
		return model.ClaimPriorityMedia, ""
	}
	return model.ClaimPriorityBaja, ""
}

func isUrgent(c ClaimPriorityInput, s ShipmentPriorityInfo) bool {
	if s.Status == model.StatusLost || s.Status == model.StatusDestroyed {
		return true
	}
	if c.Type == model.ClaimTypeDamage && c.HasEvidence && isShipmentActive(s.Status) {
		return true
	}
	if s.SLAExpired {
		return true
	}
	return false
}

func isHigh(c ClaimPriorityInput, s ShipmentPriorityInfo, cfg model.SystemConfig) bool {
	if s.PriorityScore >= cfg.ClaimsHighPriorityThreshold {
		return true
	}
	if s.DeliveryAttemptCount >= 3 && s.Status == model.StatusDeliveryFailed {
		return true
	}
	if c.Type == model.ClaimTypeMissing {
		return true
	}
	return false
}

func isMedium(c ClaimPriorityInput, s ShipmentPriorityInfo, cfg model.SystemConfig) bool {
	if s.PriorityScore >= cfg.ClaimsMediumPriorityThreshold {
		return true
	}
	if c.Type == model.ClaimTypeDelay || c.Type == model.ClaimTypeNotDelivered {
		return true
	}
	return false
}

// isShipmentActive devuelve true cuando el envío todavía está en ciclo de vida
// operativo (no es terminal). Se usa para limitar la urgencia de un reclamo de
// daño con evidencia a casos en los que el envío sigue en juego.
func isShipmentActive(status model.Status) bool {
	switch status {
	case model.StatusDelivered,
		model.StatusReturned,
		model.StatusCancelled,
		model.StatusLost,
		model.StatusDestroyed:
		return false
	}
	return true
}
