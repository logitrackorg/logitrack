package service

import (
	"testing"
	"time"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
)

func TestCanFileClaimOfType_BadTreatmentAlwaysAllowed(t *testing.T) {
	// Envío todavía en sucursal de origen, sin ETA: cualquier otro tipo se
	// rechazaría, pero bad_treatment debe pasar igual.
	ship := model.Shipment{Status: model.StatusAtOriginHub}
	if !CanFileClaimOfType(ship, model.ClaimTypeBadTreatment) {
		t.Fatalf("bad_treatment debe permitirse en at_origin_hub")
	}

	future := time.Now().Add(7 * 24 * time.Hour)
	shipWithFutureETA := model.Shipment{
		Status:              model.StatusInTransit,
		EstimatedDeliveryAt: &future,
	}
	if !CanFileClaimOfType(shipWithFutureETA, model.ClaimTypeBadTreatment) {
		t.Fatalf("bad_treatment debe permitirse incluso con ETA futura")
	}

	cancelledShip := model.Shipment{Status: model.StatusCancelled}
	if !CanFileClaimOfType(cancelledShip, model.ClaimTypeBadTreatment) {
		t.Fatalf("bad_treatment debe permitirse incluso en envío cancelado")
	}
}

func TestCanFileClaimOfType_OtherTypesRequireEligibility(t *testing.T) {
	future := time.Now().Add(7 * 24 * time.Hour)
	ship := model.Shipment{
		Status:              model.StatusInTransit,
		EstimatedDeliveryAt: &future,
	}
	// Sin entrega ni SLA vencido, los demás tipos se rechazan.
	for _, ct := range []model.ClaimType{
		model.ClaimTypeDamage,
		model.ClaimTypeMissing,
		model.ClaimTypeDelay,
		model.ClaimTypeNotDelivered,
		model.ClaimTypeWrongData,
		model.ClaimTypeOther,
	} {
		if CanFileClaimOfType(ship, ct) {
			t.Errorf("tipo %s no debería permitirse antes de entrega/SLA", ct)
		}
	}
}

func TestCanFileClaim_TrueWhenDelivered(t *testing.T) {
	ship := model.Shipment{Status: model.StatusDelivered}
	if !CanFileClaim(ship) {
		t.Fatalf("envío entregado debe permitir reclamos generales")
	}
}

func TestCanFileClaim_TrueWhenETAPastByOneHour(t *testing.T) {
	past := time.Now().Add(-2 * time.Hour)
	ship := model.Shipment{
		Status:              model.StatusInTransit,
		EstimatedDeliveryAt: &past,
	}
	if !CanFileClaim(ship) {
		t.Fatalf("envío con ETA + 1h ya vencida debe permitir reclamos generales")
	}
}

func TestCanFileClaim_FalseWhenETAStillFuture(t *testing.T) {
	future := time.Now().Add(2 * time.Hour)
	ship := model.Shipment{
		Status:              model.StatusInTransit,
		EstimatedDeliveryAt: &future,
	}
	if CanFileClaim(ship) {
		t.Fatalf("envío con ETA aún en el futuro no debe permitir reclamos generales")
	}
}

func TestCreatePublicClaim_RejectsNonBadTreatmentWhenIneligible(t *testing.T) {
	claimSvc, ts := newClaimSetup()
	ship := mustCreate(t, ts)

	// Sin override de clock: el ETA del envío recién creado está en el futuro,
	// así que canFileClaim devuelve false.
	_, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDelay,
		Description: "Demora en la entrega del paquete",
		CreatedBy:   "Alice Sender",
		DNI:         "12345678",
	}, nil)
	if err == nil {
		t.Fatalf("se esperaba error de elegibilidad para tipo no-bad_treatment")
	}
	if err.Error() != ClaimIneligibleMessage {
		t.Fatalf("error inesperado: %q (esperaba mensaje de elegibilidad)", err.Error())
	}
}

func TestCreatePublicClaim_AllowsBadTreatmentEvenWhenIneligible(t *testing.T) {
	claimSvc, ts := newClaimSetup()
	ship := mustCreate(t, ts)

	// Envío al_origin_hub recién creado: NO cumple canFileClaim. Aun así
	// bad_treatment debe poder crearse.
	claim, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeBadTreatment,
		Description: "El operador me trató de manera grosera al despachar",
		CreatedBy:   "Alice Sender",
		DNI:         "12345678",
	}, nil)
	if err != nil {
		t.Fatalf("bad_treatment debe permitirse en envío no entregado: %v", err)
	}
	if claim.ClaimType != model.ClaimTypeBadTreatment {
		t.Fatalf("tipo persistido inesperado: %s", claim.ClaimType)
	}
}

func TestCreatePublicClaim_MissingTypeFirstClassWithHighPriority(t *testing.T) {
	claimSvc, ts := newClaimSetup()
	ship := mustCreate(t, ts)
	deliverShipment(t, ts, ship.TrackingID)

	claim, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeMissing,
		Description: "Llegó el paquete pero falta uno de los productos comprados",
		CreatedBy:   "Alice Sender",
		DNI:         "12345678",
	}, nil)
	if err != nil {
		t.Fatalf("missing como tipo de primer nivel debe crearse: %v", err)
	}
	if claim.ClaimType != model.ClaimTypeMissing {
		t.Fatalf("tipo persistido inesperado: %s", claim.ClaimType)
	}
	// isHigh en claim_priority.go promueve missing a ALTA cuando no hay otra
	// regla superior. Acá tampoco hay SLA vencido ni evidencia.
	if claim.Priority != model.ClaimPriorityAlta {
		t.Fatalf("missing debe clasificarse como ALTA, fue %q", claim.Priority)
	}
}

// withEligibleClock está definido en claim_test.go.
// Verificamos también que el helper interactúe correctamente con clock.Now()
// sin dejar offset residual al final.
func TestWithEligibleClock_RestoresOffset(t *testing.T) {
	if clock.IsActive() {
		t.Fatalf("precondición: offset debe estar limpio antes del test")
	}
	t.Run("inner", func(t *testing.T) {
		withEligibleClock(t)
		if !clock.IsActive() {
			t.Fatalf("se esperaba override activo dentro del test")
		}
	})
	if clock.IsActive() {
		t.Fatalf("se esperaba override limpio tras t.Cleanup")
	}
}
