package email

import "github.com/logitrack/core/internal/model"

func claimStatusLabel(status model.ClaimStatus) string {
	switch status {
	case model.ClaimStatusOpen:
		return "Abierto"
	case model.ClaimStatusInReview:
		return "En revisión"
	case model.ClaimStatusPendingCustomer:
		return "Pendiente del cliente"
	case model.ClaimStatusDerived:
		return "Derivado"
	case model.ClaimStatusResolvedOperativa:
		return "Resuelto: operativo"
	case model.ClaimStatusResolvedComercial:
		return "Resuelto: comercial"
	case model.ClaimStatusResolvedRRHH:
		return "Resuelto: RRHH"
	case model.ClaimStatusResolvedImprocedente:
		return "Resuelto: improcedente"
	default:
		return string(status)
	}
}

func claimResolutionTypeLabel(resolution model.ClaimResolutionType) string {
	switch resolution {
	case model.ClaimResolutionOperativa:
		return "Resolución operativa"
	case model.ClaimResolutionComercial:
		return "Resolución comercial"
	case model.ClaimResolutionRRHH:
		return "Resolución RRHH"
	case model.ClaimResolutionImprocedente:
		return "Resolución improcedente"
	default:
		return string(resolution)
	}
}
