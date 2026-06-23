package service

import (
	"testing"

	"github.com/logitrack/core/internal/model"
)

// defaultCfg devuelve la configuración con los umbrales por defecto del spec.
// Lo encapsulamos en un helper porque DefaultSystemConfig() trae además otros
// 10 campos que no nos importan para estos tests.
func defaultCfg() model.SystemConfig {
	return model.SystemConfig{
		UrgentClaimsCapPct:            0.20,
		ClaimsHighPriorityThreshold:   0.65,
		ClaimsMediumPriorityThreshold: 0.35,
	}
}

func TestCalculatePriority_UrgentByLostStatus(t *testing.T) {
	got, _ := CalculatePriority(
		ClaimPriorityInput{Type: model.ClaimTypeOther, HasEvidence: false},
		ShipmentPriorityInfo{Status: model.StatusLost, PriorityScore: 0.0},
		defaultCfg(),
	)
	if got != model.ClaimPriorityUrgente {
		t.Fatalf("envío extraviado debe ser urgente, fue %q", got)
	}
}

func TestCalculatePriority_UrgentByDestroyedStatus(t *testing.T) {
	got, _ := CalculatePriority(
		ClaimPriorityInput{Type: model.ClaimTypeOther, HasEvidence: false},
		ShipmentPriorityInfo{Status: model.StatusDestroyed},
		defaultCfg(),
	)
	if got != model.ClaimPriorityUrgente {
		t.Fatalf("daño total debe ser urgente, fue %q", got)
	}
}

func TestCalculatePriority_UrgentByDamageWithEvidenceOnActiveShipment(t *testing.T) {
	got, _ := CalculatePriority(
		ClaimPriorityInput{Type: model.ClaimTypeDamage, HasEvidence: true},
		ShipmentPriorityInfo{Status: model.StatusInTransit},
		defaultCfg(),
	)
	if got != model.ClaimPriorityUrgente {
		t.Fatalf("daño con evidencia en envío activo debe ser urgente, fue %q", got)
	}
}

// El caso real más común: el cliente abre el reclamo con foto después de
// recibir el paquete dañado. El envío está en `delivered` y, aún así, debe
// clasificarse como urgente. Antes el gate isShipmentActive degradaba este
// caso silenciosamente a "baja".
func TestCalculatePriority_UrgentByDamageWithEvidenceOnDeliveredShipment(t *testing.T) {
	got, _ := CalculatePriority(
		ClaimPriorityInput{Type: model.ClaimTypeDamage, HasEvidence: true},
		ShipmentPriorityInfo{Status: model.StatusDelivered},
		defaultCfg(),
	)
	if got != model.ClaimPriorityUrgente {
		t.Fatalf("daño con evidencia en envío entregado debe ser urgente, fue %q", got)
	}
}

func TestCalculatePriority_DamageWithoutEvidenceIsNotUrgent(t *testing.T) {
	got, _ := CalculatePriority(
		ClaimPriorityInput{Type: model.ClaimTypeDamage, HasEvidence: false},
		ShipmentPriorityInfo{Status: model.StatusInTransit, PriorityScore: 0.0},
		defaultCfg(),
	)
	if got == model.ClaimPriorityUrgente {
		t.Fatalf("daño sin evidencia no debe ser urgente, fue %q", got)
	}
}

func TestCalculatePriority_UrgentBySLAExpired(t *testing.T) {
	got, _ := CalculatePriority(
		ClaimPriorityInput{Type: model.ClaimTypeOther, HasEvidence: false},
		ShipmentPriorityInfo{Status: model.StatusInTransit, SLAExpired: true},
		defaultCfg(),
	)
	if got != model.ClaimPriorityUrgente {
		t.Fatalf("SLA vencido debe forzar urgente, fue %q", got)
	}
}

func TestCalculatePriority_HighByPriorityScoreAtThreshold(t *testing.T) {
	cfg := defaultCfg()
	got, _ := CalculatePriority(
		ClaimPriorityInput{Type: model.ClaimTypeOther},
		ShipmentPriorityInfo{Status: model.StatusInTransit, PriorityScore: cfg.ClaimsHighPriorityThreshold},
		cfg,
	)
	if got != model.ClaimPriorityAlta {
		t.Fatalf("score == umbral high debe ser alta, fue %q", got)
	}
}

func TestCalculatePriority_HighByDeliveryAttempts(t *testing.T) {
	got, _ := CalculatePriority(
		ClaimPriorityInput{Type: model.ClaimTypeOther},
		ShipmentPriorityInfo{Status: model.StatusDeliveryFailed, DeliveryAttemptCount: 3},
		defaultCfg(),
	)
	if got != model.ClaimPriorityAlta {
		t.Fatalf("3 intentos + entrega fallida debe ser alta, fue %q", got)
	}
}

func TestCalculatePriority_HighByMissingClaimType(t *testing.T) {
	got, _ := CalculatePriority(
		ClaimPriorityInput{Type: model.ClaimTypeMissing},
		ShipmentPriorityInfo{Status: model.StatusInTransit, PriorityScore: 0.0},
		defaultCfg(),
	)
	if got != model.ClaimPriorityAlta {
		t.Fatalf("tipo extraviado debe ser alta, fue %q", got)
	}
}

func TestCalculatePriority_MediumByScoreAtThreshold(t *testing.T) {
	cfg := defaultCfg()
	got, _ := CalculatePriority(
		ClaimPriorityInput{Type: model.ClaimTypeOther},
		ShipmentPriorityInfo{Status: model.StatusInTransit, PriorityScore: cfg.ClaimsMediumPriorityThreshold},
		cfg,
	)
	if got != model.ClaimPriorityMedia {
		t.Fatalf("score == umbral medium debe ser media, fue %q", got)
	}
}

func TestCalculatePriority_MediumJustBelowHighThreshold(t *testing.T) {
	cfg := defaultCfg()
	got, _ := CalculatePriority(
		ClaimPriorityInput{Type: model.ClaimTypeOther},
		ShipmentPriorityInfo{Status: model.StatusInTransit, PriorityScore: cfg.ClaimsHighPriorityThreshold - 0.0001},
		cfg,
	)
	if got != model.ClaimPriorityMedia {
		t.Fatalf("score justo debajo del umbral high debe ser media, fue %q", got)
	}
}

func TestCalculatePriority_MediumByDelayClaimType(t *testing.T) {
	got, _ := CalculatePriority(
		ClaimPriorityInput{Type: model.ClaimTypeDelay},
		ShipmentPriorityInfo{Status: model.StatusInTransit, PriorityScore: 0.0},
		defaultCfg(),
	)
	if got != model.ClaimPriorityMedia {
		t.Fatalf("tipo demorado debe ser media, fue %q", got)
	}
}

func TestCalculatePriority_MediumByNotDeliveredClaimType(t *testing.T) {
	got, _ := CalculatePriority(
		ClaimPriorityInput{Type: model.ClaimTypeNotDelivered},
		ShipmentPriorityInfo{Status: model.StatusInTransit, PriorityScore: 0.0},
		defaultCfg(),
	)
	if got != model.ClaimPriorityMedia {
		t.Fatalf("tipo no_entregado debe ser media, fue %q", got)
	}
}

func TestCalculatePriority_LowDefault(t *testing.T) {
	got, _ := CalculatePriority(
		ClaimPriorityInput{Type: model.ClaimTypeBadTreatment},
		ShipmentPriorityInfo{Status: model.StatusInTransit, PriorityScore: 0.0},
		defaultCfg(),
	)
	if got != model.ClaimPriorityBaja {
		t.Fatalf("default debe ser baja, fue %q", got)
	}
}

func TestCalculatePriority_LowJustBelowMediumThreshold(t *testing.T) {
	cfg := defaultCfg()
	got, _ := CalculatePriority(
		ClaimPriorityInput{Type: model.ClaimTypeBadTreatment},
		ShipmentPriorityInfo{Status: model.StatusInTransit, PriorityScore: cfg.ClaimsMediumPriorityThreshold - 0.0001},
		cfg,
	)
	if got != model.ClaimPriorityBaja {
		t.Fatalf("score justo debajo del umbral medium debe ser baja, fue %q", got)
	}
}

// El SLA vencido pisa cualquier otra regla — verificamos que un envío que de
// otra forma sería "alta" se promueva a urgente cuando el SLA expira.
func TestCalculatePriority_SLAExpiredOverridesHigh(t *testing.T) {
	cfg := defaultCfg()
	got, _ := CalculatePriority(
		ClaimPriorityInput{Type: model.ClaimTypeMissing},
		ShipmentPriorityInfo{
			Status:        model.StatusInTransit,
			PriorityScore: cfg.ClaimsHighPriorityThreshold,
			SLAExpired:    true,
		},
		cfg,
	)
	if got != model.ClaimPriorityUrgente {
		t.Fatalf("SLA vencido debe pisar reglas de alta, fue %q", got)
	}
}
